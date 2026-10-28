// The sidecar WebSocket, opened here instead of in the webview. A game host's network
// may reset TLS handshakes whose SNI names a domain it has not allowlisted, and the
// webview always sends SNI. This connection sends none, but still verifies the
// certificate against the URL's host name and the Mozilla root set: no switch skips
// that check. The webview drives each socket through sidecar_open / sidecar_send /
// sidecar_close and receives open / message / close on a channel, with the browser
// WebSocket's close-code semantics (src/platform/sidecarSocket.ts).

use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use tauri::{ipc::Channel, AppHandle, Manager, Url};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
    sync::mpsc,
    time::Instant,
};
use tokio_rustls::{
    rustls::{self, pki_types::ServerName},
    TlsConnector,
};
use tokio_tungstenite::{
    client_async,
    tungstenite::{
        protocol::{frame::coding::CloseCode, CloseFrame},
        Message,
    },
    WebSocketStream,
};

// Browser close codes for "no close frame" (connection failed or dropped) and
// "close frame without a status code".
const CLOSE_ABNORMAL: u16 = 1006;
const CLOSE_NO_STATUS: u16 = 1005;
// How long a locally closed socket waits for the sidecar's closing handshake.
const CLOSE_GRACE: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SidecarSocketEvent {
    Open,
    Message { data: String },
    Close { code: u16, reason: String },
}

enum Outgoing {
    Text(String),
    Close(u16, String),
}

#[derive(Default)]
pub struct SidecarSockets {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, mpsc::UnboundedSender<Outgoing>>>,
}

impl SidecarSockets {
    fn insert(&self, sender: mpsc::UnboundedSender<Outgoing>) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut open) = self.open.lock() {
            open.insert(id, sender);
        }
        id
    }

    fn remove(&self, id: u32) {
        if let Ok(mut open) = self.open.lock() {
            open.remove(&id);
        }
    }

    // Like the browser, a socket that has already closed drops what it is given.
    fn queue(&self, id: u32, outgoing: Outgoing) {
        if let Some(sender) = self
            .open
            .lock()
            .ok()
            .and_then(|open| open.get(&id).cloned())
        {
            let _ = sender.send(outgoing);
        }
    }
}

#[derive(Debug)]
struct Target {
    url: Url,
    host: String,
    port: u16,
    tls: bool,
}

fn parse_target(raw: &str) -> Result<Target, String> {
    let url = Url::parse(raw).map_err(|error| format!("Invalid sidecar endpoint: {error}"))?;
    let tls = match url.scheme() {
        "wss" => true,
        "ws" => false,
        scheme => return Err(format!("Unsupported sidecar endpoint scheme {scheme}")),
    };
    // IPv6 literals come bracketed; the socket address and the server name take them bare.
    let host = url
        .host_str()
        .ok_or("Sidecar endpoint has no host")?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    // Plain ws:// exists only for the local development sidecar.
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if !tls && !loopback {
        return Err("ws:// sidecar endpoints must be on a loopback host".into());
    }
    let port = url
        .port_or_known_default()
        .ok_or("Sidecar endpoint has no port")?;
    Ok(Target {
        url,
        host,
        port,
        tls,
    })
}

fn tls_config(roots: rustls::RootCertStore) -> Arc<rustls::ClientConfig> {
    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .expect("ring supports the default TLS versions")
    .with_root_certificates(roots)
    .with_no_client_auth();
    // The certificate is still checked against the host name given to connect().
    config.enable_sni = false;
    Arc::new(config)
}

fn mozilla_tls_config() -> Arc<rustls::ClientConfig> {
    static CONFIG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            tls_config(rustls::RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            })
        })
        .clone()
}

trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

async fn connect(
    target: &Target,
    tls: Arc<rustls::ClientConfig>,
) -> Result<WebSocketStream<Box<dyn Io>>, String> {
    let tcp = TcpStream::connect((target.host.as_str(), target.port))
        .await
        .map_err(|error| format!("TCP connect failed: {error}"))?;
    let _ = tcp.set_nodelay(true);
    let stream: Box<dyn Io> = if target.tls {
        let name = ServerName::try_from(target.host.clone())
            .map_err(|error| format!("Invalid TLS server name: {error}"))?;
        let tls = TlsConnector::from(tls)
            .connect(name, tcp)
            .await
            .map_err(|error| format!("TLS handshake failed: {error}"))?;
        Box::new(tls)
    } else {
        Box::new(tcp)
    };
    let (socket, _) = client_async(target.url.as_str(), stream)
        .await
        .map_err(|error| format!("WebSocket handshake failed: {error}"))?;
    Ok(socket)
}

/// Runs one socket until it closes and returns the close code and reason to report.
/// `emit` returns false once the webview no longer listens, which ends the socket.
async fn run(
    target: Target,
    tls: Arc<rustls::ClientConfig>,
    mut commands: mpsc::UnboundedReceiver<Outgoing>,
    emit: impl Fn(SidecarSocketEvent) -> bool,
) -> (u16, String) {
    let abnormal = || (CLOSE_ABNORMAL, String::new());
    let connecting = connect(&target, tls);
    tokio::pin!(connecting);
    // The webview only sends once open; anything earlier still goes out in order.
    let mut early = Vec::new();
    let mut socket = loop {
        tokio::select! {
            connected = &mut connecting => match connected {
                Ok(socket) => break socket,
                Err(error) => {
                    diag!("SLGO: sidecar {}: {error}", target.url);
                    return abnormal();
                }
            },
            command = commands.recv() => match command {
                Some(Outgoing::Text(text)) => early.push(text),
                Some(Outgoing::Close(..)) | None => return abnormal(),
            },
        }
    };
    if !emit(SidecarSocketEvent::Open) {
        let _ = socket.close(None).await;
        return abnormal();
    }
    for text in early {
        if let Err(error) = socket.send(Message::text(text)).await {
            diag!("SLGO: sidecar send failed: {error}");
            return abnormal();
        }
    }

    let mut received: Option<(u16, String)> = None;
    let mut closing_deadline: Option<Instant> = None;
    loop {
        tokio::select! {
            frame = socket.next() => match frame {
                Some(Ok(Message::Text(text))) => {
                    if !emit(SidecarSocketEvent::Message { data: text.to_string() }) {
                        let _ = socket.close(None).await;
                        return abnormal();
                    }
                }
                // tungstenite answers the close frame; keep reading until the stream ends.
                Some(Ok(Message::Close(frame))) => {
                    received = Some(frame.map_or((CLOSE_NO_STATUS, String::new()), |frame| {
                        (u16::from(frame.code), frame.reason.to_string())
                    }));
                }
                // The sidecar sends text only; pings are answered by tungstenite.
                Some(Ok(_)) => {}
                Some(Err(error)) => {
                    if received.is_none() && closing_deadline.is_none() {
                        diag!("SLGO: sidecar connection lost: {error}");
                    }
                    return received.unwrap_or_else(abnormal);
                }
                None => return received.unwrap_or_else(abnormal),
            },
            command = commands.recv(), if closing_deadline.is_none() => match command {
                Some(Outgoing::Text(text)) => {
                    if let Err(error) = socket.send(Message::text(text)).await {
                        diag!("SLGO: sidecar send failed: {error}");
                        return abnormal();
                    }
                }
                Some(Outgoing::Close(code, reason)) => {
                    let frame = CloseFrame { code: CloseCode::from(code), reason: reason.into() };
                    let _ = socket.close(Some(frame)).await;
                    closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                }
                None => {
                    let _ = socket.close(None).await;
                    closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                }
            },
            _ = tokio::time::sleep_until(closing_deadline.unwrap_or_else(Instant::now)), if closing_deadline.is_some() => {
                return received.unwrap_or_else(abnormal);
            }
        }
    }
}

/// Starts a socket and returns its id; events arrive on `on_event`, ending with one close.
#[tauri::command]
pub fn sidecar_open(
    app: AppHandle,
    sockets: tauri::State<'_, SidecarSockets>,
    url: String,
    on_event: Channel<SidecarSocketEvent>,
) -> Result<u32, String> {
    let target = parse_target(&url)?;
    let (sender, receiver) = mpsc::unbounded_channel();
    let id = sockets.insert(sender);
    tauri::async_runtime::spawn(async move {
        let emit = |event| on_event.send(event).is_ok();
        let (code, reason) = run(target, mozilla_tls_config(), receiver, emit).await;
        app.state::<SidecarSockets>().remove(id);
        let _ = on_event.send(SidecarSocketEvent::Close { code, reason });
    });
    Ok(id)
}

#[tauri::command]
pub fn sidecar_send(sockets: tauri::State<'_, SidecarSockets>, id: u32, data: String) {
    sockets.queue(id, Outgoing::Text(data));
}

#[tauri::command]
pub fn sidecar_close(
    sockets: tauri::State<'_, SidecarSockets>,
    id: u32,
    code: u16,
    reason: String,
) {
    sockets.queue(id, Outgoing::Close(code, reason));
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::generate_simple_self_signed;
    use tokio::net::TcpListener;
    use tokio_rustls::{
        rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
        TlsAcceptor,
    };

    #[test]
    fn plain_ws_is_only_allowed_on_loopback() {
        for url in [
            "ws://127.0.0.1:7801/slgo/sidecar",
            "ws://localhost:7801/slgo/sidecar",
            "ws://[::1]:7801/slgo/sidecar",
            "wss://sidecar.example.com:7790/slgo/sidecar",
        ] {
            assert!(parse_target(url).is_ok(), "{url}");
        }
        for url in [
            "ws://sidecar.example.com:7801/slgo/sidecar",
            "ws://192.0.2.1:7801/slgo/sidecar",
            "https://sidecar.example.com/slgo/sidecar",
            "not a url",
        ] {
            assert!(parse_target(url).is_err(), "{url}");
        }
        let target = parse_target("wss://sidecar.example.com/slgo/sidecar").unwrap();
        assert_eq!(
            (target.host.as_str(), target.port, target.tls),
            ("sidecar.example.com", 443, true)
        );
    }

    struct Server {
        port: u16,
        roots: rustls::RootCertStore,
        // The SNI each accepted handshake carried.
        sni: tokio::task::JoinHandle<Option<String>>,
    }

    // A one-connection TLS sidecar for `cert_name`: it sends "baseline", echoes one
    // text frame and closes with 4003.
    async fn serve_once(cert_name: &str) -> Server {
        let key = generate_simple_self_signed(vec![cert_name.to_owned()]).unwrap();
        let cert: CertificateDer<'static> = key.cert.der().clone();
        let mut roots = rustls::RootCertStore::empty();
        roots.add(cert.clone()).unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.signing_key.serialize_der())),
        )
        .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let sni = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let Ok(tls) = TlsAcceptor::from(Arc::new(config)).accept(tcp).await else {
                return None;
            };
            let sni = tls.get_ref().1.server_name().map(str::to_owned);
            let mut socket = tokio_tungstenite::accept_async(tls).await.unwrap();
            socket.send(Message::text("baseline")).await.unwrap();
            while let Some(Ok(frame)) = socket.next().await {
                if let Message::Text(text) = frame {
                    socket.send(Message::Text(text)).await.unwrap();
                    break;
                }
            }
            let frame = CloseFrame {
                code: CloseCode::from(4003),
                reason: "ended".into(),
            };
            socket.close(Some(frame)).await.unwrap();
            while socket.next().await.is_some() {}
            sni
        });
        Server { port, roots, sni }
    }

    // Connects to the server as `localhost`, answers "baseline" with "hello" and
    // returns the events and the reported close.
    async fn exchange(
        server: &Server,
        config: Arc<rustls::ClientConfig>,
    ) -> (Vec<SidecarSocketEvent>, (u16, String)) {
        let target =
            parse_target(&format!("wss://localhost:{}/slgo/sidecar", server.port)).unwrap();
        let (sender, receiver) = mpsc::unbounded_channel();
        let events = Mutex::new(Vec::new());
        let closed = run(target, config, receiver, |event| {
            if event
                == (SidecarSocketEvent::Message {
                    data: "baseline".into(),
                })
            {
                let _ = sender.send(Outgoing::Text("hello".into()));
            }
            events.lock().unwrap().push(event);
            true
        })
        .await;
        (events.into_inner().unwrap(), closed)
    }

    #[tokio::test]
    async fn sends_no_sni_and_reports_the_sidecar_close() {
        let server = serve_once("localhost").await;
        let (events, closed) = exchange(&server, tls_config(server.roots.clone())).await;
        assert_eq!(
            events,
            [
                SidecarSocketEvent::Open,
                SidecarSocketEvent::Message {
                    data: "baseline".into()
                },
                SidecarSocketEvent::Message {
                    data: "hello".into()
                },
            ]
        );
        assert_eq!(closed, (4003, "ended".into()));
        assert_eq!(
            server.sni.await.unwrap(),
            None,
            "the handshake carries no SNI"
        );

        // The same server does see SNI when it is enabled, so the check above is real.
        let server = serve_once("localhost").await;
        let mut with_sni = (*tls_config(server.roots.clone())).clone();
        with_sni.enable_sni = true;
        exchange(&server, Arc::new(with_sni)).await;
        assert_eq!(server.sni.await.unwrap().as_deref(), Some("localhost"));
    }

    #[tokio::test]
    async fn rejects_a_certificate_for_another_host() {
        let server = serve_once("sidecar.example.com").await;
        let (events, closed) = exchange(&server, tls_config(server.roots.clone())).await;
        assert!(events.is_empty(), "never opens: {events:?}");
        assert_eq!(closed, (CLOSE_ABNORMAL, String::new()));
        assert_eq!(
            server.sni.await.unwrap(),
            None,
            "the server never completes the handshake"
        );
    }

    // Manual check against a real sidecar with the production TLS settings:
    //     SLUI_SIDECAR_PROBE_URL=wss://<host>:<port>/slgo/sidecar cargo test -p slui -- --ignored probe
    // It opens the socket and sends an invalid session.open, so the sidecar closes it.
    #[tokio::test]
    #[ignore = "needs a reachable sidecar in SLUI_SIDECAR_PROBE_URL"]
    async fn probe_a_real_sidecar() {
        let url = std::env::var("SLUI_SIDECAR_PROBE_URL").expect("SLUI_SIDECAR_PROBE_URL");
        let (sender, receiver) = mpsc::unbounded_channel();
        let events = Mutex::new(Vec::new());
        let closed = run(
            parse_target(&url).unwrap(),
            mozilla_tls_config(),
            receiver,
            |event| {
                if event == SidecarSocketEvent::Open {
                    let _ = sender.send(Outgoing::Text("{}".into()));
                }
                events.lock().unwrap().push(event);
                true
            },
        )
        .await;
        let events = events.into_inner().unwrap();
        eprintln!("events {events:?}, closed {closed:?}");
        assert_eq!(events.first(), Some(&SidecarSocketEvent::Open));
        assert_ne!(
            closed.0, CLOSE_ABNORMAL,
            "the sidecar closes the session itself"
        );
    }
}

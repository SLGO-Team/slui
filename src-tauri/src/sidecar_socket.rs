// The sidecar WebSocket, opened here instead of in the webview. A game host's network
// may reset TLS handshakes whose SNI names a domain it has not allowlisted, and the
// webview always sends SNI. This connection sends none, but still verifies the
// certificate against the URL's host name and the Mozilla root set: no switch skips
// that check. The webview drives each socket through sidecar_open / sidecar_send /
// sidecar_close and receives open / message / close on a channel, with the browser
// WebSocket's close-code semantics (src/platform/sidecarSocket.ts).
//
// A connection that dies silently (Wi-Fi switch, sleep, NAT timeout) sends no close and no
// TCP reset. The heartbeat finds it: a ping goes out at a fixed interval, and when no frame
// of any kind arrives for a while the socket ends with 1006, which the webview retries.

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
    sync::{
        mpsc::{self, error::TrySendError},
        Notify,
    },
    time::{Instant, MissedTickBehavior},
};
use tokio_rustls::{
    rustls::{self, pki_types::ServerName},
    TlsConnector,
};
use tokio_tungstenite::{
    client_async_with_config,
    tungstenite::{
        protocol::{frame::coding::CloseCode, CloseFrame, WebSocketConfig},
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
// Every text message is forwarded to the webview, so a hostile sidecar must not get
// tungstenite's defaults (64 MiB messages) through. Baselines carry the facility layout,
// so the cap stays generous.
const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
// The webview sends a handful of small commands; a full queue means the socket is stuck, and
// it is ended (1006, so the webview reconnects) instead of growing without bound.
const SEND_QUEUE_CAPACITY: usize = 64;
// An old socket in its closing grace period plus its replacement. Only the overlay connects.
const MAX_OPEN_SOCKETS: usize = 2;
// A peer that stopped reading leaves a send waiting on a full TCP buffer, and nothing else
// in the loop runs meanwhile, the heartbeat included.
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug)]
struct Heartbeat {
    /// How often a ping goes out once the socket is open.
    interval: Duration,
    /// How long the socket may go without receiving any frame; the sidecar answers every ping.
    timeout: Duration,
}

const HEARTBEAT: Heartbeat = Heartbeat {
    interval: Duration::from_secs(10),
    timeout: Duration::from_secs(25),
};

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

/// The webview's side of one socket: its command queue and the signal that it overflowed.
#[derive(Clone)]
struct SocketHandle {
    commands: mpsc::Sender<Outgoing>,
    overflow: Arc<Notify>,
}

/// The socket task's side of a `SocketHandle`.
struct SocketInbox {
    commands: mpsc::Receiver<Outgoing>,
    overflow: Arc<Notify>,
}

fn socket_channel() -> (SocketHandle, SocketInbox) {
    let (sender, receiver) = mpsc::channel(SEND_QUEUE_CAPACITY);
    let overflow = Arc::new(Notify::new());
    let handle = SocketHandle {
        commands: sender,
        overflow: overflow.clone(),
    };
    let inbox = SocketInbox {
        commands: receiver,
        overflow,
    };
    (handle, inbox)
}

#[derive(Default)]
pub struct SidecarSockets {
    next_id: AtomicU32,
    open: Mutex<HashMap<u32, SocketHandle>>,
}

impl SidecarSockets {
    fn insert(&self, handle: SocketHandle) -> Result<u32, String> {
        let mut open = self
            .open
            .lock()
            .map_err(|_| "Sidecar socket table is unavailable")?;
        if open.len() >= MAX_OPEN_SOCKETS {
            return Err(format!("At most {MAX_OPEN_SOCKETS} sidecar sockets may be open"));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        open.insert(id, handle);
        Ok(id)
    }

    fn remove(&self, id: u32) {
        if let Ok(mut open) = self.open.lock() {
            open.remove(&id);
        }
    }

    // Like the browser, a socket that has already closed drops what it is given.
    fn queue(&self, id: u32, outgoing: Outgoing) {
        let Some(handle) = self
            .open
            .lock()
            .ok()
            .and_then(|open| open.get(&id).cloned())
        else {
            return;
        };
        match handle.commands.try_send(outgoing) {
            Ok(()) | Err(TrySendError::Closed(_)) => {}
            Err(TrySendError::Full(_)) => handle.overflow.notify_one(),
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

// Plain ws:// exists only for the local development sidecar, which has no TLS: `tauri dev`
// (debug builds) and local test packages (`local-backend`, set by tauri.local.conf.json). A
// released build only speaks wss://, so a route cannot point it at a plain local port.
const ALLOW_PLAIN_WS: bool = cfg!(any(debug_assertions, feature = "local-backend"));

fn parse_target(raw: &str, allow_plain_ws: bool) -> Result<Target, String> {
    let url = Url::parse(raw).map_err(|error| format!("Invalid sidecar endpoint: {error}"))?;
    let tls = match url.scheme() {
        "wss" => true,
        "ws" if allow_plain_ws => false,
        "ws" => return Err("ws:// sidecar endpoints are only allowed in local builds".into()),
        scheme => return Err(format!("Unsupported sidecar endpoint scheme {scheme}")),
    };
    // IPv6 literals come bracketed; the socket address and the server name take them bare.
    let host = url
        .host_str()
        .ok_or("Sidecar endpoint has no host")?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    // Even there, only on this machine.
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
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));
    let (socket, _) = client_async_with_config(target.url.as_str(), stream, Some(config))
        .await
        .map_err(|error| format!("WebSocket handshake failed: {error}"))?;
    Ok(socket)
}

type Socket = WebSocketStream<Box<dyn Io>>;

async fn send_within(socket: &mut Socket, message: Message) -> Result<(), String> {
    match tokio::time::timeout(SEND_TIMEOUT, socket.send(message)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(format!("send failed: {error}")),
        Err(_) => Err("send timed out".into()),
    }
}

// The closing handshake is best effort: a dead peer must not hold the task.
async fn close_within(socket: &mut Socket, frame: Option<CloseFrame>) {
    let _ = tokio::time::timeout(CLOSE_GRACE, socket.close(frame)).await;
}

/// Runs one socket until it closes and returns the close code and reason to report.
/// `emit` returns false once the webview no longer listens, which ends the socket.
async fn run(
    target: Target,
    tls: Arc<rustls::ClientConfig>,
    inbox: SocketInbox,
    heartbeat: Heartbeat,
    emit: impl Fn(SidecarSocketEvent) -> bool,
) -> (u16, String) {
    let SocketInbox {
        mut commands,
        overflow,
    } = inbox;
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
                Some(Outgoing::Text(_)) if early.len() >= SEND_QUEUE_CAPACITY => {
                    diag!("SLGO: sidecar {}: too many messages before the socket opened", target.url);
                    return abnormal();
                }
                Some(Outgoing::Text(text)) => early.push(text),
                Some(Outgoing::Close(..)) | None => return abnormal(),
            },
        }
    };
    if !emit(SidecarSocketEvent::Open) {
        close_within(&mut socket, None).await;
        return abnormal();
    }
    for text in early {
        if let Err(error) = send_within(&mut socket, Message::text(text)).await {
            diag!("SLGO: sidecar {error}");
            return abnormal();
        }
    }

    let mut received: Option<(u16, String)> = None;
    // Set once either side has sent its close frame; only the stream's end is awaited then.
    let mut closing_deadline: Option<Instant> = None;
    let mut silent_deadline = Instant::now() + heartbeat.timeout;
    let mut pings = tokio::time::interval_at(Instant::now() + heartbeat.interval, heartbeat.interval);
    pings.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            frame = socket.next() => {
                // Any frame proves the peer is there: data, pongs, the sidecar's own pings.
                if matches!(frame, Some(Ok(_))) {
                    silent_deadline = Instant::now() + heartbeat.timeout;
                }
                match frame {
                    Some(Ok(Message::Text(text))) => {
                        if !emit(SidecarSocketEvent::Message { data: text.to_string() }) {
                            close_within(&mut socket, None).await;
                            return abnormal();
                        }
                    }
                    // tungstenite answers the close frame; keep reading until the stream ends.
                    Some(Ok(Message::Close(frame))) => {
                        received = Some(frame.map_or((CLOSE_NO_STATUS, String::new()), |frame| {
                            (u16::from(frame.code), frame.reason.to_string())
                        }));
                        closing_deadline.get_or_insert_with(|| Instant::now() + CLOSE_GRACE);
                    }
                    // tungstenite answers pings itself.
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        if received.is_none() && closing_deadline.is_none() {
                            diag!("SLGO: sidecar connection lost: {error}");
                        }
                        return received.unwrap_or_else(abnormal);
                    }
                    None => return received.unwrap_or_else(abnormal),
                }
            },
            command = commands.recv(), if closing_deadline.is_none() => match command {
                Some(Outgoing::Text(text)) => {
                    if let Err(error) = send_within(&mut socket, Message::text(text)).await {
                        diag!("SLGO: sidecar {error}");
                        return abnormal();
                    }
                }
                Some(Outgoing::Close(code, reason)) => {
                    let frame = CloseFrame { code: CloseCode::from(code), reason: reason.into() };
                    close_within(&mut socket, Some(frame)).await;
                    closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                }
                None => {
                    close_within(&mut socket, None).await;
                    closing_deadline = Some(Instant::now() + CLOSE_GRACE);
                }
            },
            () = overflow.notified(), if closing_deadline.is_none() => {
                diag!("SLGO: sidecar {}: send queue full, closing", target.url);
                close_within(&mut socket, None).await;
                return abnormal();
            }
            _ = pings.tick(), if closing_deadline.is_none() => {
                if let Err(error) = send_within(&mut socket, Message::Ping(Default::default())).await {
                    diag!("SLGO: sidecar ping {error}");
                    return abnormal();
                }
            }
            () = tokio::time::sleep_until(silent_deadline), if closing_deadline.is_none() => {
                diag!("SLGO: sidecar {}: nothing received for {:?}, connection lost", target.url, heartbeat.timeout);
                return abnormal();
            }
            () = tokio::time::sleep_until(closing_deadline.unwrap_or_else(Instant::now)), if closing_deadline.is_some() => {
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
    let target = parse_target(&url, ALLOW_PLAIN_WS)?;
    let (handle, inbox) = socket_channel();
    let id = sockets.insert(handle)?;
    tauri::async_runtime::spawn(async move {
        let emit = |event| on_event.send(event).is_ok();
        let (code, reason) = run(target, mozilla_tls_config(), inbox, HEARTBEAT, emit).await;
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
    fn plain_ws_is_only_allowed_on_loopback_in_local_builds() {
        let loopback = [
            "ws://127.0.0.1:7801/slgo/sidecar",
            "ws://localhost:7801/slgo/sidecar",
            "ws://[::1]:7801/slgo/sidecar",
        ];
        for url in loopback {
            assert!(parse_target(url, true).is_ok(), "{url}");
            assert!(parse_target(url, false).is_err(), "released builds: {url}");
        }
        for allow_plain_ws in [true, false] {
            assert!(parse_target("wss://sidecar.example.com:7790/slgo/sidecar", allow_plain_ws).is_ok());
            for url in [
                "ws://sidecar.example.com:7801/slgo/sidecar",
                "ws://192.0.2.1:7801/slgo/sidecar",
                "https://sidecar.example.com/slgo/sidecar",
                "not a url",
            ] {
                assert!(parse_target(url, allow_plain_ws).is_err(), "{url}");
            }
        }
        let target = parse_target("wss://sidecar.example.com/slgo/sidecar", false).unwrap();
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

    type ServerSocket = WebSocketStream<tokio_rustls::server::TlsStream<tokio::net::TcpStream>>;

    // A one-connection TLS sidecar for `cert_name`: it sends "baseline", echoes one
    // text frame and closes with 4003.
    async fn serve_once(cert_name: &str) -> Server {
        serve_with(cert_name, |mut socket| async move {
            while let Some(Ok(frame)) = socket.next().await {
                if let Message::Text(text) = frame {
                    socket.send(Message::Text(text)).await.unwrap();
                    break;
                }
            }
            close_with_4003(socket).await;
        })
        .await
    }

    async fn close_with_4003(mut socket: ServerSocket) {
        let frame = CloseFrame {
            code: CloseCode::from(4003),
            reason: "ended".into(),
        };
        socket.close(Some(frame)).await.unwrap();
        while socket.next().await.is_some() {}
    }

    // Like serve_once, but after "baseline" the socket is handed to `after_baseline`.
    async fn serve_with<F, Fut>(cert_name: &str, after_baseline: F) -> Server
    where
        F: FnOnce(ServerSocket) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
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
            after_baseline(socket).await;
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
        exchange_with(server, config, HEARTBEAT, |handle| {
            handle.commands.try_send(Outgoing::Text("hello".into())).unwrap();
        })
        .await
    }

    // Connects with production TLS settings for the test certificate, runs `on_baseline`
    // with the socket's handle when "baseline" arrives, and returns events and close.
    async fn exchange_with(
        server: &Server,
        config: Arc<rustls::ClientConfig>,
        heartbeat: Heartbeat,
        on_baseline: impl Fn(&SocketHandle),
    ) -> (Vec<SidecarSocketEvent>, (u16, String)) {
        let target =
            parse_target(&format!("wss://localhost:{}/slgo/sidecar", server.port), false).unwrap();
        let (handle, inbox) = socket_channel();
        let events = Mutex::new(Vec::new());
        let closed = run(target, config, inbox, heartbeat, |event| {
            if event
                == (SidecarSocketEvent::Message {
                    data: "baseline".into(),
                })
            {
                on_baseline(&handle);
            }
            events.lock().unwrap().push(event);
            true
        })
        .await;
        (events.into_inner().unwrap(), closed)
    }

    const FAST_HEARTBEAT: Heartbeat = Heartbeat {
        interval: Duration::from_millis(50),
        timeout: Duration::from_millis(300),
    };

    #[tokio::test]
    async fn a_silent_peer_ends_the_socket_as_lost() {
        // The sidecar's host vanished: the socket stays open but nothing is read or answered.
        let server = serve_with("localhost", |socket| async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            drop(socket);
        })
        .await;
        let started = Instant::now();
        let (events, closed) =
            exchange_with(&server, tls_config(server.roots.clone()), FAST_HEARTBEAT, |_| {}).await;
        assert_eq!(closed, (CLOSE_ABNORMAL, String::new()));
        assert_eq!(events.len(), 2, "open and baseline: {events:?}");
        let elapsed = started.elapsed();
        assert!(
            elapsed >= FAST_HEARTBEAT.timeout && elapsed < Duration::from_secs(5),
            "ended after {elapsed:?}"
        );
        server.sni.abort();
    }

    #[tokio::test]
    async fn a_quiet_peer_that_answers_pings_stays_connected() {
        // No data for several heartbeat timeouts, but every ping is answered (tungstenite
        // replies while the server reads), so the sidecar's own close is what ends it.
        let server = serve_with("localhost", |mut socket| async move {
            let quiet = tokio::time::timeout(Duration::from_millis(1_200), async {
                while let Some(Ok(_)) = socket.next().await {}
            });
            assert!(quiet.await.is_err(), "the client keeps the socket open");
            close_with_4003(socket).await;
        })
        .await;
        let (_, closed) =
            exchange_with(&server, tls_config(server.roots.clone()), FAST_HEARTBEAT, |_| {}).await;
        assert_eq!(closed, (4003, "ended".into()));
        server.sni.await.unwrap();
    }

    #[tokio::test]
    async fn a_full_send_queue_ends_the_socket() {
        let server = serve_with("localhost", |mut socket| async move {
            while let Some(Ok(_)) = socket.next().await {}
        })
        .await;
        let (_, closed) = exchange_with(&server, tls_config(server.roots.clone()), HEARTBEAT, |handle| {
            handle.overflow.notify_one();
        })
        .await;
        assert_eq!(closed, (CLOSE_ABNORMAL, String::new()));
    }

    #[test]
    fn queueing_past_the_capacity_signals_overflow() {
        let sockets = SidecarSockets::default();
        let (handle, inbox) = socket_channel();
        let id = sockets.insert(handle).unwrap();
        for index in 0..SEND_QUEUE_CAPACITY {
            sockets.queue(id, Outgoing::Text(index.to_string()));
        }
        let overflowed = || futures_util::FutureExt::now_or_never(inbox.overflow.notified()).is_some();
        assert!(!overflowed(), "a full queue is not an overflow yet");
        sockets.queue(id, Outgoing::Text("one too many".into()));
        assert!(overflowed());
    }

    #[test]
    fn at_most_two_sockets_are_open() {
        let sockets = SidecarSockets::default();
        let first = sockets.insert(socket_channel().0).unwrap();
        sockets.insert(socket_channel().0).unwrap();
        assert!(sockets.insert(socket_channel().0).is_err(), "a third socket is refused");
        sockets.remove(first);
        assert!(sockets.insert(socket_channel().0).is_ok(), "a closed socket frees its slot");
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
        let (handle, inbox) = socket_channel();
        let events = Mutex::new(Vec::new());
        let closed = run(
            parse_target(&url, false).unwrap(),
            mozilla_tls_config(),
            inbox,
            HEARTBEAT,
            |event| {
                if event == SidecarSocketEvent::Open {
                    let _ = handle.commands.try_send(Outgoing::Text("{}".into()));
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

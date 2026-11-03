// A stand-in game window: SLUI recognises the game by its executable name (SCPSL.exe). Closes itself after N seconds.
using System; using System.Windows.Forms;
static class Program {
  [STAThread] static void Main(string[] args) {
    int seconds = args.Length > 0 ? int.Parse(args[0]) : 8;
    var form = new Form { Text = "SLUI perf test (fake game)", Width = 960, Height = 540, StartPosition = FormStartPosition.Manual, Left = 100, Top = 100, BackColor = System.Drawing.Color.FromArgb(40, 44, 52) };
    var timer = new Timer { Interval = seconds * 1000 };
    timer.Tick += (s, e) => form.Close();
    form.Shown += (s, e) => { form.Activate(); timer.Start(); };
    Application.Run(form);
  }
}

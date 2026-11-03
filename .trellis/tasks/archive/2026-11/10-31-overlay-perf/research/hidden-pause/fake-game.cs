// A stand-in game window: SLUI recognises the game by its executable name (SCPSL.exe). Closes itself after N seconds.
// Usage: SCPSL.exe [seconds] [width] [height] (logical px of a DPI-unaware window; 1280x720 is 1920x1080 at 150 %).
using System; using System.Windows.Forms;
static class Program {
  [STAThread] static void Main(string[] args) {
    int seconds = args.Length > 0 ? int.Parse(args[0]) : 8;
    int width = args.Length > 1 ? int.Parse(args[1]) : 960;
    int height = args.Length > 2 ? int.Parse(args[2]) : 540;
    var form = new Form { Text = "SLUI perf test (fake game)", FormBorderStyle = FormBorderStyle.None, Width = width, Height = height,
      StartPosition = FormStartPosition.Manual, Left = 0, Top = 0, BackColor = System.Drawing.Color.FromArgb(40, 44, 52) };
    var timer = new Timer { Interval = seconds * 1000 };
    timer.Tick += (s, e) => form.Close();
    form.Shown += (s, e) => { form.Activate(); timer.Start(); };
    Application.Run(form);
  }
}

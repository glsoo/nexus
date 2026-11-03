using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        // The server runs "Nexus.exe --pick-folder" for the web app's Open a folder, when the browser is on this PC.
        if (args.Length > 0 && args[0] == "--pick-folder")
        {
            try { Environment.ExitCode = FolderPicker.Run(args.Length > 1 ? args[1] : null, args.Length > 2 ? args[2] : null, args.Length > 3 ? args[3] : null); }
            catch (Exception error) { Console.Error.Write(error.Message); Environment.ExitCode = 2; }
            return;
        }
        string root = Path.GetFullPath(Path.Combine(Application.StartupPath, ".."));
        string key;
        using (SHA256 hash = SHA256.Create())
            key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(root.ToUpperInvariant()))).Replace("-", "").Substring(0, 16);
        bool first;
        using (Mutex mutex = new Mutex(true, "Local\\Nexus-" + Environment.UserName + "-" + key, out first))
        {
            if (!first)
            {
                IntPtr window = FindWindow(null, "Nexus Launcher");
                ShowWindow(window, 9);
                SetForegroundWindow(window);
                return;
            }
            try { Application.Run(new Launcher(root, key)); }
            catch (Exception error) { MessageBox.Show(error.Message, "Nexus", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { mutex.ReleaseMutex(); }
        }
    }
}

// Windows' own Select Folder dialog (the Explorer-style one). Prints the chosen folder as UTF-8 and returns 0, or returns 1 when cancelled.
internal static class FolderPicker
{
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] private class FileOpenDialog { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, IntPtr specs);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem item);
        void SetFolder(IShellItem item);
        void GetFolder(out IShellItem item);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, int where);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, [MarshalAs(UnmanagedType.LPWStr)] out string name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr context, [MarshalAs(UnmanagedType.LPStruct)] Guid iid, out IShellItem item);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint to, bool on);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);

    private const uint NoChangeDir = 0x8, PickFolders = 0x20, ForceFileSystem = 0x40, PathMustExist = 0x800, FileSystemPath = 0x80058000;
    // Windows remembers the last folder chosen under this id, so the dialog opens where you left off.
    private static readonly Guid Remember = new Guid("5d1b6f0e-6c0b-4c39-9a3e-0f7e1c2b9a41");

    public static int Run(string title, string button, string start)
    {
        // The dialog's owner is a hidden topmost window that takes the foreground from the browser that asked, so the dialog shows on top of it.
        using (var owner = new Form { ShowInTaskbar = false, TopMost = true, FormBorderStyle = FormBorderStyle.None, StartPosition = FormStartPosition.CenterScreen, Size = new Size(1, 1), Opacity = 0 })
        {
            owner.Show();
            uint theirs = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero), ours = GetCurrentThreadId();
            AttachThreadInput(theirs, ours, true);
            SetForegroundWindow(owner.Handle);
            AttachThreadInput(theirs, ours, false);
            var dialog = (IFileOpenDialog)new FileOpenDialog();
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | PickFolders | ForceFileSystem | PathMustExist | NoChangeDir);
            Guid remember = Remember;
            dialog.SetClientGuid(ref remember);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
            if (!string.IsNullOrEmpty(button)) dialog.SetOkButtonLabel(button);
            if (!string.IsNullOrEmpty(start) && Directory.Exists(start))
            {
                IShellItem folder;
                SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out folder);
                dialog.SetFolder(folder);
            }
            if (dialog.Show(owner.Handle) != 0) return 1;
            IShellItem picked;
            dialog.GetResult(out picked);
            string path;
            picked.GetDisplayName(FileSystemPath, out path);
            byte[] bytes = Encoding.UTF8.GetBytes(path);
            using (Stream output = Console.OpenStandardOutput()) output.Write(bytes, 0, bytes.Length);
            return 0;
        }
    }
}

// Palette mirrors public/style.css :root so the launcher matches the web app.
internal static class Theme
{
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] private static extern int SetWindowTheme(IntPtr window, string app, string idList);

    public static readonly Color Bg = Color.FromArgb(0x00, 0x00, 0x00);
    public static readonly Color Card = Color.FromArgb(0x11, 0x11, 0x11);
    public static readonly Color Raised = Color.FromArgb(0x1c, 0x1c, 0x1c);
    public static readonly Color Line = Color.FromArgb(0x1f, 0x1f, 0x1f);
    public static readonly Color LineStrong = Color.FromArgb(0x36, 0x36, 0x36);
    public static readonly Color Fg = Color.FromArgb(0xf5, 0xf5, 0xf5);
    public static readonly Color Muted = Color.FromArgb(0xa1, 0xa1, 0xa1);
    public static readonly Color Accent = Color.FromArgb(0x7e, 0x22, 0xce);
    public static readonly Color AccentHover = Color.FromArgb(0x93, 0x33, 0xea);
    public static readonly Color AccentDown = Color.FromArgb(0x6b, 0x21, 0xa8);
    public static readonly Color OnAccent = Color.White;
    public static readonly Color Danger = Color.FromArgb(0xf8, 0x71, 0x71);
    public static readonly Color DangerLine = Color.FromArgb(0x7f, 0x1d, 0x1d);
    public static readonly Color Warn = Color.FromArgb(0xfb, 0xbf, 0x24);
    public static readonly Color Info = Color.FromArgb(0x7d, 0xd3, 0xfc);
    public static readonly Color Ok = Color.FromArgb(0x34, 0xd3, 0x99);

    public static readonly Font Sans = new Font("Segoe UI", 10);
    public static readonly Font SansSemibold = new Font("Segoe UI Semibold", 10);
    public static readonly Font Small = new Font("Segoe UI", 9);
    public static readonly string MonoFamily = FindMono();
    public static readonly Font Mono = new Font(MonoFamily, 10);

    private static string FindMono()
    {
        foreach (FontFamily family in FontFamily.Families) if (family.Name == "Cascadia Mono") return family.Name;
        return "Consolas";
    }

    public static void Apply(Form form)
    {
        form.BackColor = Bg; form.ForeColor = Fg; form.Font = Sans;
        if (form.IsHandleCreated) DarkTitle(form.Handle);
        form.HandleCreated += delegate { DarkTitle(form.Handle); };
    }

    private static void DarkTitle(IntPtr window)
    {
        int on = 1;
        try { if (DwmSetWindowAttribute(window, 20, ref on, 4) != 0) DwmSetWindowAttribute(window, 19, ref on, 4); }
        catch (DllNotFoundException) { }
        catch (EntryPointNotFoundException) { }
    }

    public static void DarkScrollbars(Control control)
    {
        control.HandleCreated += delegate {
            try { SetWindowTheme(control.Handle, "DarkMode_Explorer", null); }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
        };
    }

    public static GraphicsPath Round(Rectangle r, int radius)
    {
        int d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
        var path = new GraphicsPath();
        if (d <= 0) { path.AddRectangle(r); return path; }
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    public static int Scale(Control control, int value)
    {
        return (int)Math.Round(value * control.DeviceDpi / 96f);
    }

    public static T Field<T>(T input) where T : Control
    {
        input.BackColor = Bg; input.ForeColor = Fg;
        var box = input as TextBox; if (box != null) box.BorderStyle = BorderStyle.FixedSingle;
        var number = input as NumericUpDown; if (number != null) number.BorderStyle = BorderStyle.FixedSingle;
        return input;
    }
}

// Owner-drawn button styled like .btn / .btn.primary / .btn.danger. Still a native BUTTON window, so test.ps1 finds it.
internal sealed class ThemedButton : Button
{
    private bool primary, danger, hover, down;
    public bool Primary { get { return primary; } set { primary = value; Font = value ? Theme.SansSemibold : Theme.Sans; Invalidate(); } }
    public bool Danger { get { return danger; } set { danger = value; Invalidate(); } }

    public ThemedButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; UseVisualStyleBackColor = false;
        BackColor = Theme.Bg; ForeColor = Theme.Fg; Font = Theme.Sans; Cursor = Cursors.Hand;
        AutoSize = true; Padding = new Padding(10, 5, 10, 5); MinimumSize = new Size(0, 34); Margin = new Padding(0, 0, 8, 8);
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { down = true; Invalidate(); } base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        Color fill = primary ? (down ? Theme.AccentDown : hover ? Theme.AccentHover : Theme.Accent)
                             : (down ? Theme.LineStrong : hover ? Theme.Raised : Theme.Card);
        Color border = primary ? fill : danger ? Theme.DangerLine : Theme.LineStrong;
        bool focus = Focused && ShowFocusCues;
        using (GraphicsPath path = Theme.Round(new Rectangle(1, 1, Width - 3, Height - 3), Theme.Scale(this, 8)))
        using (var brush = new SolidBrush(Enabled ? fill : Theme.Card))
        using (var pen = new Pen(focus ? Theme.Fg : border, focus ? 2f : 1f))
        {
            g.FillPath(brush, path); g.DrawPath(pen, path);
        }
        Color text = !Enabled ? Theme.Muted : primary ? Theme.OnAccent : danger ? Theme.Danger : Theme.Fg;
        TextRenderer.DrawText(g, Text, Font, ClientRectangle, text,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
    }
}

// Rounded surface like .login form.
internal sealed class CardPanel : Panel
{
    public CardPanel()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Theme.Card;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (GraphicsPath path = Theme.Round(new Rectangle(0, 0, Width - 1, Height - 1), Theme.Scale(this, 14)))
        using (var brush = new SolidBrush(Theme.Card))
        using (var pen = new Pen(Theme.Line))
        {
            g.FillPath(brush, path); g.DrawPath(pen, path);
        }
    }
}

// Status indicator like .dot / .dot.busy (pulses while busy).
internal sealed class StatusDot : Control
{
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 700 };
    private Color color = Theme.LineStrong;
    private bool dim;

    public StatusDot()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Size = new Size(9, 9); Anchor = AnchorStyles.Left; Margin = new Padding(0, 0, 9, 0);
        timer.Tick += delegate { dim = !dim; Invalidate(); };
    }

    public void Set(Color value, bool pulse)
    {
        color = value; dim = false;
        if (pulse) timer.Start(); else timer.Stop();
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent != null ? Parent.BackColor : Theme.Card);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var brush = new SolidBrush(dim ? Color.FromArgb(90, color) : color))
            e.Graphics.FillEllipse(brush, 0, 0, Width - 1, Height - 1);
    }

    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
}

internal sealed class Launcher : Form
{
    private readonly string root, node, bash, credentialFile;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly StringBuilder log = new StringBuilder();
    private readonly object logLock = new object();
    private readonly System.Windows.Forms.Timer ready = new System.Windows.Forms.Timer();
    private readonly Label statusLabel = new Label { AutoSize = true, Text = "Starting", Font = Theme.SansSemibold, Anchor = AnchorStyles.Left };
    private readonly StatusDot statusDot = new StatusDot();
    private readonly Label accountLabel = new Label { AutoSize = true, ForeColor = Theme.Muted };
    private readonly LinkLabel address = new LinkLabel { AutoSize = true, Font = Theme.Mono, LinkColor = Theme.Info, ActiveLinkColor = Theme.Fg,
        VisitedLinkColor = Theme.Info, LinkBehavior = LinkBehavior.HoverUnderline };
    private readonly ThemedButton toggle = new ThemedButton { Text = "Stop", Danger = true };
    private Dictionary<string, object> config;
    private Process server;
    private DateTime starting;
    private string url;

    private static string SearchPath
    {
        get { return Environment.ExpandEnvironmentVariables(Environment.GetEnvironmentVariable("PATH") + ";" +
            Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) + ";" +
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "WinGet", "Links")); }
    }

    private static string FindExecutable(string name)
    {
        foreach (string dir in SearchPath.Split(';'))
        {
            if (String.IsNullOrWhiteSpace(dir)) continue;
            string file = Path.Combine(dir.Trim().Trim('"'), name);
            if (File.Exists(file)) return file;
        }
        throw new InvalidOperationException("Missing " + name + ". Run windows/install.ps1 after installing the prerequisites.");
    }

    public Launcher(string root, string key)
    {
        this.root = root;
        node = FindExecutable("node.exe");
        string git = FindExecutable("git.exe");
        FindExecutable("rg.exe");
        bash = Environment.GetEnvironmentVariable("SHELL");
        if (String.IsNullOrEmpty(bash) || !File.Exists(bash))
            foreach (string relative in new[] { "../bin/bash.exe", "../../bin/bash.exe" })
            {
                string candidate = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(git), relative));
                if (File.Exists(candidate)) { bash = candidate; break; }
            }
        if (String.IsNullOrEmpty(bash) || !File.Exists(bash)) throw new InvalidOperationException("Install Git for Windows to provide Git Bash.");
        if (Int32.Parse(RunNode("--version", null).Trim().TrimStart('v').Split('.')[0]) < 24)
            throw new InvalidOperationException("Nexus requires Node.js 24 or newer.");
        string stateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Nexus", key);
        Directory.CreateDirectory(stateDir);
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(stateDir).SetAccessControl(security);
        credentialFile = Path.Combine(stateDir, "login.dpapi");
        config = ReadConfig();
        if (!(bool)config["configured"])
        {
            string password;
            using (RandomNumberGenerator random = RandomNumberGenerator.Create())
            {
                byte[] bytes = new byte[24]; random.GetBytes(bytes);
                password = Convert.ToBase64String(bytes); Array.Clear(bytes, 0, bytes.Length);
            }
            SaveConfig(Environment.UserName, password, new Dictionary<string, string> {
                { "NEXUS_AUTO_UPDATE", "0" }, { "SHELL", bash.Replace('\\', '/') },
                { "NEXUS_PROJECTS", Path.Combine(Path.GetDirectoryName(root), "NexusProjects").Replace('\\', '/') }
            });
            SaveCredential(Environment.UserName, password);
            config = ReadConfig();
        }
        Text = "Nexus Launcher"; Theme.Apply(this); AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(600, 260); MinimumSize = new Size(600, 300); StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), RowCount = 3, ColumnCount = 1 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        // Header: logo + mono wordmark, like .login .brand
        var brand = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 14) };
        string iconFile = Path.Combine(root, "public", "icon-180.png");
        if (File.Exists(iconFile))
        {
            var logo = new PictureBox { Size = new Size(30, 30), SizeMode = PictureBoxSizeMode.Zoom, Margin = new Padding(0, 0, 10, 0), Anchor = AnchorStyles.Left };
            using (Image image = Image.FromFile(iconFile)) logo.Image = new Bitmap(image);
            brand.Controls.Add(logo);
            using (var small = new Bitmap(logo.Image, 32, 32)) Icon = Icon.FromHandle(small.GetHicon());
        }
        // The multi-size icon install.ps1 builds keeps the taskbar button sharp at any scale.
        string icoFile = Path.Combine(Application.StartupPath, "Nexus.ico");
        if (File.Exists(icoFile)) Icon = new Icon(icoFile);
        brand.Controls.Add(new Label { Text = "Nexus", AutoSize = true, Anchor = AnchorStyles.Left, Font = new Font(Theme.MonoFamily, 16, FontStyle.Bold), Margin = new Padding(0) });
        layout.Controls.Add(brand, 0, 0);

        // Status card, like .login form
        var card = new CardPanel { Dock = DockStyle.Fill, Padding = new Padding(18, 14, 18, 14), Margin = new Padding(0, 0, 0, 16) };
        var info = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, BackColor = Theme.Card };
        var statusRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 8) };
        statusLabel.Margin = new Padding(0); statusRow.Controls.Add(statusDot); statusRow.Controls.Add(statusLabel);
        info.Controls.Add(statusRow);
        address.Margin = new Padding(0, 0, 0, 6); address.LinkClicked += delegate { Guard(OpenBrowser); }; info.Controls.Add(address);
        accountLabel.Margin = new Padding(0); info.Controls.Add(accountLabel);
        card.Controls.Add(info); layout.Controls.Add(card, 0, 1);
        SetStatus("Starting", Theme.Accent, true);

        var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true, Margin = new Padding(0) };
        AddButton(buttons, "Open Nexus", OpenBrowser).Primary = true;
        AddButton(buttons, "Settings", EditSettings);
        AddButton(buttons, "Copy Password", delegate {
            var saved = ReadCredential();
            if (saved == null || (string)saved["user"] != (string)config["user"])
                throw new InvalidOperationException("Set a new password in Settings first.");
            Clipboard.SetText((string)saved["pass"]); statusLabel.Text = "Password copied";
        });
        toggle.Click += delegate { Guard(delegate { if (server == null) StartServer(); else StopServer(); }); };
        buttons.Controls.Add(toggle); AddButton(buttons, "Server Log", ShowLog);
        layout.Controls.Add(buttons, 0, 2); Controls.Add(layout);
        ready.Interval = 300; ready.Tick += delegate { CheckReady(); };
        Shown += delegate { Guard(StartServer); };
        FormClosing += delegate(object sender, FormClosingEventArgs args) {
            try { StopServer(); }
            catch (Exception error) { args.Cancel = true; MessageBox.Show(this, error.Message, "Nexus", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        };
        FormClosed += delegate { ready.Dispose(); };
    }

    private ThemedButton AddButton(Control parent, string text, Action action)
    {
        var button = new ThemedButton { Text = text };
        button.Click += delegate { Guard(action); }; parent.Controls.Add(button);
        return button;
    }

    private void SetStatus(string text, Color dot, bool pulse)
    {
        statusLabel.Text = text; statusDot.Set(dot, pulse);
    }

    private void Guard(Action action)
    {
        try { action(); }
        catch (Exception error) { MessageBox.Show(this, error.Message, "Nexus", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private ProcessStartInfo NodeInfo(string args)
    {
        var info = new ProcessStartInfo(node, args) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true };
        info.EnvironmentVariables["PATH"] = SearchPath;
        info.EnvironmentVariables["HOME"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!String.IsNullOrEmpty(bash)) info.EnvironmentVariables["SHELL"] = bash;
        return info;
    }

    private string RunNode(string args, string input)
    {
        using (var process = new Process())
        {
            process.StartInfo = NodeInfo(args);
            process.StartInfo.RedirectStandardInput = process.StartInfo.RedirectStandardOutput = process.StartInfo.RedirectStandardError = true;
            process.StartInfo.StandardOutputEncoding = process.StartInfo.StandardErrorEncoding = Encoding.UTF8;
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
            if (input != null)
            {
                byte[] bytes = Encoding.UTF8.GetBytes(input);
                try { process.StandardInput.BaseStream.Write(bytes, 0, bytes.Length); }
                finally { Array.Clear(bytes, 0, bytes.Length); }
            }
            process.StandardInput.Close();
            if (!process.WaitForExit(15000)) { process.Kill(); process.WaitForExit(); throw new TimeoutException("Nexus setup timed out."); }
            string result = output.Result; string error = errors.Result;
            if (process.ExitCode != 0) throw new InvalidOperationException(error.Trim());
            return result;
        }
    }

    private Dictionary<string, object> ReadConfig()
    {
        return json.Deserialize<Dictionary<string, object>>(RunNode("scripts/set-password.js --windows --status", null));
    }

    private void SaveConfig(string user, string password, Dictionary<string, string> settings)
    {
        var input = new Dictionary<string, object> { { "user", user }, { "settings", settings } };
        if (!String.IsNullOrEmpty(password)) input["pass"] = password;
        RunNode("scripts/set-password.js --windows --stdin", json.Serialize(input));
        var security = new FileSecurity(); security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl, AccessControlType.Allow));
        File.SetAccessControl(Path.Combine(root, "windows", ".env"), security);
    }

    private void SaveCredential(string user, string password)
    {
        byte[] plain = Encoding.UTF8.GetBytes(json.Serialize(new Dictionary<string, string> { { "user", user }, { "pass", password } }));
        try { File.WriteAllBytes(credentialFile, ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser)); }
        finally { Array.Clear(plain, 0, plain.Length); }
    }

    private Dictionary<string, object> ReadCredential()
    {
        if (!File.Exists(credentialFile)) return null;
        byte[] plain;
        try { plain = ProtectedData.Unprotect(File.ReadAllBytes(credentialFile), null, DataProtectionScope.CurrentUser); }
        catch (CryptographicException) { AppendLog("Saved password unavailable. Set a new password in Settings."); return null; }
        try { return json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(plain)); }
        finally { Array.Clear(plain, 0, plain.Length); }
    }

    private void AppendLog(string text)
    {
        if (text == null) return;
        lock (logLock) { log.AppendLine(text); if (log.Length > 32000) log.Remove(0, log.Length - 32000); }
    }

    private void StartServer()
    {
        if (server != null) StopServer();
        config = ReadConfig();
        int port = Convert.ToInt32(config["port"]);
        if (port < 1 || port > 65535) throw new InvalidOperationException("Choose a valid port in Settings.");
        var probe = new TcpListener(IPAddress.Loopback, port);
        try { probe.Start(); }
        catch (SocketException) { throw new InvalidOperationException("Port " + port + " is in use. Choose another port in Settings."); }
        finally { probe.Stop(); }
        url = "http://127.0.0.1:" + port; address.Text = url; accountLabel.Text = "Login: " + config["user"];
        lock (logLock) { log.Clear(); }
        server = new Process { StartInfo = NodeInfo("scripts/start.js") };
        server.StartInfo.RedirectStandardOutput = server.StartInfo.RedirectStandardError = true;
        server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { AppendLog(args.Data); };
        server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { AppendLog(args.Data); };
        try { server.Start(); server.BeginOutputReadLine(); server.BeginErrorReadLine(); }
        catch { server.Dispose(); server = null; throw; }
        starting = DateTime.UtcNow; SetStatus("Starting", Theme.Accent, true); toggle.Text = "Stop"; toggle.Danger = true; ready.Start();
    }

    private void CheckReady()
    {
        if (server == null) { ready.Stop(); return; }
        if (server.HasExited || DateTime.UtcNow - starting > TimeSpan.FromSeconds(20))
        {
            ready.Stop(); Guard(delegate { StopServer(); throw new InvalidOperationException("Nexus could not start. Open Server Log for details."); }); return;
        }
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Proxy = null; request.Timeout = request.ReadWriteTimeout = 300;
            using (var response = (HttpWebResponse)request.GetResponse()) if (response.StatusCode != HttpStatusCode.OK) return;
        }
        catch (WebException) { return; }
        ready.Stop();
        if ((bool)config["openai"] || (bool)config["anthropic"]) SetStatus("Running", Theme.Ok, false);
        else SetStatus("Running - API key needed", Theme.Warn, false);
        Guard(OpenBrowser);
    }

    private void StopServer()
    {
        ready.Stop();
        if (server != null)
        {
            if (!server.HasExited)
            {
                var info = new ProcessStartInfo("taskkill.exe", "/PID " + server.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true };
                using (Process killer = Process.Start(info)) if (!killer.WaitForExit(5000)) throw new TimeoutException("Could not stop the Nexus process tree.");
                if (!server.WaitForExit(5000)) throw new TimeoutException("Nexus is still stopping.");
            }
            server.Dispose(); server = null;
        }
        SetStatus("Stopped", Theme.LineStrong, false); toggle.Text = "Start"; toggle.Danger = false;
    }

    private void OpenBrowser()
    {
        if (server == null || server.HasExited) throw new InvalidOperationException("Start Nexus first.");
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private void ShowLog()
    {
        string text; lock (logLock) { text = log.ToString(); }
        using (var dialog = new Form { Text = "Nexus Server Log", Size = new Size(760, 480), StartPosition = FormStartPosition.CenterParent })
        {
            Theme.Apply(dialog); dialog.ShowIcon = false;
            var output = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Text = text,
                Font = Theme.Mono, BackColor = Theme.Bg, ForeColor = Theme.Fg, BorderStyle = BorderStyle.None };
            Theme.DarkScrollbars(output);
            var frame = new Panel { Dock = DockStyle.Fill, Padding = new Padding(12, 10, 4, 4) };
            frame.Controls.Add(output); dialog.Controls.Add(frame);
            dialog.Shown += delegate { output.SelectionStart = output.TextLength; output.ScrollToCaret(); };
            dialog.ShowDialog(this);
        }
    }

    private void EditSettings()
    {
        var saved = ReadCredential();
        using (var dialog = new Form { Text = "Nexus Settings", ClientSize = new Size(550, 340), FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterParent })
        {
            Theme.Apply(dialog); dialog.ShowIcon = false;
            var fields = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 8 };
            fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 155)); fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            var user = Theme.Field(new TextBox { Text = (string)config["user"], Dock = DockStyle.Fill, AccessibleName = "Username" });
            var password = Theme.Field(new TextBox { Text = saved != null && (string)saved["user"] == (string)config["user"] ? (string)saved["pass"] : "",
                UseSystemPasswordChar = true, Dock = DockStyle.Fill, AccessibleName = "Password" });
            var openai = Theme.Field(new TextBox { UseSystemPasswordChar = true, Dock = DockStyle.Fill, AccessibleName = "OpenAI API Key" });
            var anthropic = Theme.Field(new TextBox { UseSystemPasswordChar = true, Dock = DockStyle.Fill, AccessibleName = "Anthropic API Key" });
            var port = Theme.Field(new NumericUpDown { Minimum = 1, Maximum = 65535, Value = Convert.ToInt32(config["port"]), AccessibleName = "Port" });
            string[] labels = { "Username", "Password", "OpenAI API Key", "Anthropic API Key", "Port" };
            Control[] inputs = { user, password, openai, anthropic, port };
            for (int index = 0; index < labels.Length; index++)
            {
                fields.Controls.Add(new Label { Text = labels[index], AutoSize = true, Anchor = AnchorStyles.Left, ForeColor = Theme.Muted }, 0, index);
                inputs[index].Margin = new Padding(3, 4, 3, 4);
                fields.Controls.Add(inputs[index], 1, index);
            }
            var provider = new Label { Text = "OpenAI: " + ((bool)config["openai"] ? "configured" : "not set") +
                "   Anthropic: " + ((bool)config["anthropic"] ? "configured" : "not set"), AutoSize = true, ForeColor = Theme.Muted, Font = Theme.Small,
                Margin = new Padding(3, 8, 3, 4) };
            fields.Controls.Add(provider, 0, 5); fields.SetColumnSpan(provider, 2);
            var show = new CheckBox { Text = "Show credentials", AutoSize = true, FlatStyle = FlatStyle.Flat, ForeColor = Theme.Fg };
            show.FlatAppearance.BorderColor = Theme.LineStrong;
            show.CheckedChanged += delegate { password.UseSystemPasswordChar = openai.UseSystemPasswordChar = anthropic.UseSystemPasswordChar = !show.Checked; };
            fields.Controls.Add(show, 1, 6);
            var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, Margin = new Padding(0, 10, 0, 0) };
            var save = new ThemedButton { Text = "Save", Primary = true, DialogResult = DialogResult.OK, Margin = new Padding(8, 0, 0, 0) };
            actions.Controls.Add(save); actions.Controls.Add(new ThemedButton { Text = "Cancel", DialogResult = DialogResult.Cancel, Margin = new Padding(0) });
            fields.Controls.Add(actions, 0, 7); fields.SetColumnSpan(actions, 2);
            dialog.Controls.Add(fields); dialog.AcceptButton = save;
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            var settings = new Dictionary<string, string> { { "NEXUS_PORT", port.Value.ToString() }, { "NEXUS_AUTO_UPDATE", "0" } };
            if (!String.IsNullOrWhiteSpace(openai.Text)) settings["OPENAI_API_KEY"] = openai.Text.Trim();
            if (!String.IsNullOrWhiteSpace(anthropic.Text)) settings["ANTHROPIC_API_KEY"] = anthropic.Text.Trim();
            SaveConfig(user.Text, password.Text, settings);
            if (!String.IsNullOrEmpty(password.Text)) SaveCredential(user.Text.Trim(), password.Text);
            config = ReadConfig(); StartServer();
        }
    }
}
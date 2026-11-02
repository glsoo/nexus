using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
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
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
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

internal sealed class Launcher : Form
{
    private readonly string root, node, bash, credentialFile;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly StringBuilder log = new StringBuilder();
    private readonly object logLock = new object();
    private readonly System.Windows.Forms.Timer ready = new System.Windows.Forms.Timer();
    private readonly Label statusLabel = new Label { AutoSize = true, Text = "Starting" };
    private readonly Label accountLabel = new Label { AutoSize = true };
    private readonly LinkLabel address = new LinkLabel { AutoSize = true };
    private readonly Button toggle = new Button { AutoSize = true, Text = "Stop" };
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
        Text = "Nexus Launcher"; Font = new Font("Segoe UI", 10); AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(600, 260); MinimumSize = new Size(600, 300); StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), RowCount = 6, ColumnCount = 1 };
        layout.Controls.Add(new Label { Text = "Nexus", AutoSize = true, Font = new Font("Segoe UI", 23, FontStyle.Bold) });
        statusLabel.Margin = new Padding(0, 10, 0, 6); layout.Controls.Add(statusLabel);
        address.LinkClicked += delegate { Guard(OpenBrowser); }; layout.Controls.Add(address);
        accountLabel.Margin = new Padding(0, 8, 0, 12); layout.Controls.Add(accountLabel);
        var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
        AddButton(buttons, "Open Nexus", OpenBrowser);
        AddButton(buttons, "Settings", EditSettings);
        AddButton(buttons, "Copy Password", delegate {
            var saved = ReadCredential();
            if (saved == null || (string)saved["user"] != (string)config["user"])
                throw new InvalidOperationException("Set a new password in Settings first.");
            Clipboard.SetText((string)saved["pass"]); statusLabel.Text = "Password copied";
        });
        toggle.Click += delegate { Guard(delegate { if (server == null) StartServer(); else StopServer(); }); };
        buttons.Controls.Add(toggle); AddButton(buttons, "Server Log", ShowLog);
        layout.Controls.Add(buttons); Controls.Add(layout);
        ready.Interval = 300; ready.Tick += delegate { CheckReady(); };
        Shown += delegate { Guard(StartServer); };
        FormClosing += delegate(object sender, FormClosingEventArgs args) {
            try { StopServer(); }
            catch (Exception error) { args.Cancel = true; MessageBox.Show(this, error.Message, "Nexus", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        };
        FormClosed += delegate { ready.Dispose(); };
    }

    private void AddButton(Control parent, string text, Action action)
    {
        var button = new Button { Text = text, AutoSize = true, Padding = new Padding(4) };
        button.Click += delegate { Guard(action); }; parent.Controls.Add(button);
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
        starting = DateTime.UtcNow; statusLabel.Text = "Starting"; toggle.Text = "Stop"; ready.Start();
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
        statusLabel.Text = (bool)config["openai"] || (bool)config["anthropic"] ? "Running" : "Running - API key needed";
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
        statusLabel.Text = "Stopped"; toggle.Text = "Start";
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
            dialog.Controls.Add(new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, Dock = DockStyle.Fill, Text = text, Font = new Font("Consolas", 10) });
            dialog.ShowDialog(this);
        }
    }

    private void EditSettings()
    {
        var saved = ReadCredential();
        using (var dialog = new Form { Text = "Nexus Settings", ClientSize = new Size(550, 310), FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterParent })
        {
            var fields = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 8 };
            fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 155)); fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            var user = new TextBox { Text = (string)config["user"], Dock = DockStyle.Fill, AccessibleName = "Username" };
            var password = new TextBox { Text = saved != null && (string)saved["user"] == (string)config["user"] ? (string)saved["pass"] : "",
                UseSystemPasswordChar = true, Dock = DockStyle.Fill, AccessibleName = "Password" };
            var openai = new TextBox { UseSystemPasswordChar = true, Dock = DockStyle.Fill, AccessibleName = "OpenAI API Key" };
            var anthropic = new TextBox { UseSystemPasswordChar = true, Dock = DockStyle.Fill, AccessibleName = "Anthropic API Key" };
            var port = new NumericUpDown { Minimum = 1, Maximum = 65535, Value = Convert.ToInt32(config["port"]), AccessibleName = "Port" };
            string[] labels = { "Username", "Password", "OpenAI API Key", "Anthropic API Key", "Port" };
            Control[] inputs = { user, password, openai, anthropic, port };
            for (int index = 0; index < labels.Length; index++)
            {
                fields.Controls.Add(new Label { Text = labels[index], AutoSize = true, Anchor = AnchorStyles.Left }, 0, index);
                fields.Controls.Add(inputs[index], 1, index);
            }
            var provider = new Label { Text = "OpenAI: " + ((bool)config["openai"] ? "configured" : "not set") +
                "   Anthropic: " + ((bool)config["anthropic"] ? "configured" : "not set"), AutoSize = true };
            fields.Controls.Add(provider, 0, 5); fields.SetColumnSpan(provider, 2);
            var show = new CheckBox { Text = "Show credentials", AutoSize = true };
            show.CheckedChanged += delegate { password.UseSystemPasswordChar = openai.UseSystemPasswordChar = anthropic.UseSystemPasswordChar = !show.Checked; };
            fields.Controls.Add(show, 1, 6);
            var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft };
            var save = new Button { Text = "Save", AutoSize = true, DialogResult = DialogResult.OK };
            actions.Controls.Add(save); actions.Controls.Add(new Button { Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel });
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
using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class Program
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [STAThread]
    private static int Main()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return 1;

        StringBuilder name = new StringBuilder(256);
        GetClassName(hwnd, name, name.Capacity);
        string cls = name.ToString();

        // The desktop is hosted by Progman on most systems, WorkerW when
        // wallpaper slideshows / third-party wallpaper tools are active.
        if (cls == "Progman" || cls == "WorkerW" || cls == "SHELLDLL_DefView")
            return 0;
        return 2;
    }
}

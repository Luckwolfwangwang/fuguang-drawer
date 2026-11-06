param(
    [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class FuguangShellMenu
{
    private const uint CMF_NORMAL = 0x00000000;
    private const uint CMF_EXTENDEDVERBS = 0x00000100;
    private const uint TPM_RETURNCMD = 0x0100;
    private const uint TPM_RIGHTBUTTON = 0x0002;
    private const int SW_SHOWNORMAL = 1;
    private const int ID_FIRST = 1;
    private const int ID_LAST = 0x7FFF;
    private const uint WM_NULL = 0x0000;

    private static readonly Guid IID_IShellItem =
        new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
    private static readonly Guid IID_IContextMenu =
        new Guid("000214e4-0000-0000-c000-000000000046");
    private static readonly Guid BHID_SFUIObject =
        new Guid("3981e225-f559-11d3-8e3a-00c04f6837d5");

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CMINVOKECOMMANDINFO
    {
        public int cbSize;
        public int fMask;
        public IntPtr hwnd;
        public IntPtr lpVerb;
        public IntPtr lpParameters;
        public IntPtr lpDirectory;
        public int nShow;
        public int dwHotKey;
        public IntPtr hIcon;
    }

    [ComImport]
    [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        [PreserveSig] int BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        [PreserveSig] int GetParent(out IShellItem ppsi);
        [PreserveSig] int GetDisplayName(int sigdnName, out IntPtr ppszName);
        [PreserveSig] int GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        [PreserveSig] int Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport]
    [Guid("000214e4-0000-0000-c000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IContextMenu
    {
        [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, int idCmdFirst, int idCmdLast, uint uFlags);
        [PreserveSig] void InvokeCommand(ref CMINVOKECOMMANDINFO pici);
        [PreserveSig] void GetCommandString(IntPtr idCmd, uint uType, IntPtr pReserved, IntPtr pszName, uint cchMax);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc,
        ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName,
        uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu,
        IntPtr instance, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenuEx(IntPtr hMenu, uint uFlags, int x, int y,
        IntPtr hwnd, IntPtr lptpm);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static void Show(string path)
    {
        // Per-monitor DPI aware, so the menu opens exactly at the cursor.
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }

        Thread thread = new Thread(() => ShowOnSta(path));
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        thread.Join();
    }

    private static void ShowOnSta(string path)
    {
        IShellItem item = null;
        IContextMenu contextMenu = null;
        IntPtr menu = IntPtr.Zero;
        IntPtr owner = IntPtr.Zero;

        try
        {
            Guid iidItem = IID_IShellItem;
            SHCreateItemFromParsingName(path, IntPtr.Zero, ref iidItem, out item);
            Guid bhid = BHID_SFUIObject;
            Guid iidMenu = IID_IContextMenu;
            IntPtr ptr;
            int hr = item.BindToHandler(IntPtr.Zero, ref bhid, ref iidMenu, out ptr);
            if (hr != 0 || ptr == IntPtr.Zero) return;
            contextMenu = (IContextMenu)Marshal.GetObjectForIUnknown(ptr);
            Marshal.Release(ptr);

            menu = CreatePopupMenu();
            int result = contextMenu.QueryContextMenu(menu, 0, ID_FIRST, ID_LAST,
                CMF_NORMAL | CMF_EXTENDEDVERBS);
            if (result < 0) return;

            // A hidden 1x1 top-level window is enough to own the popup menu.
            owner = CreateWindowEx(0, "STATIC", "", 0, -32000, -32000, 1, 1,
                IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            SetForegroundWindow(owner);

            POINT pt;
            GetCursorPos(out pt);
            int command = TrackPopupMenuEx(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON,
                pt.X, pt.Y, owner, IntPtr.Zero);
            if (command > 0)
            {
                CMINVOKECOMMANDINFO info = new CMINVOKECOMMANDINFO();
                info.cbSize = Marshal.SizeOf(typeof(CMINVOKECOMMANDINFO));
                info.fMask = 0;
                info.hwnd = owner;
                info.lpVerb = new IntPtr(command - ID_FIRST);
                info.lpParameters = IntPtr.Zero;
                info.lpDirectory = IntPtr.Zero;
                info.nShow = SW_SHOWNORMAL;
                info.dwHotKey = 0;
                info.hIcon = IntPtr.Zero;
                contextMenu.InvokeCommand(ref info);
            }
            PostMessage(owner, WM_NULL, IntPtr.Zero, IntPtr.Zero);
        }
        catch { }
        finally
        {
            if (owner != IntPtr.Zero) DestroyWindow(owner);
            if (menu != IntPtr.Zero) DestroyMenu(menu);
            if (contextMenu != null) Marshal.ReleaseComObject(contextMenu);
            if (item != null) Marshal.ReleaseComObject(item);
        }
    }
}
'@

[FuguangShellMenu]::Show($Path)

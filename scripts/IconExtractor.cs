using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class FuguangIconExtractor
{
    private const uint SHGFI_SYSICONINDEX = 0x00004000;
    private const int SHIL_EXTRALARGE = 2;
    private const int SHIL_JUMBO = 4;
    private const int ILD_TRANSPARENT = 1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEINFO
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [ComImport]
    [Guid("46EB5926-582E-4017-9FDF-E8998DAA0950")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IImageList
    {
        [PreserveSig] int Add(IntPtr hbmImage, IntPtr hbmMask, out int pi);
        [PreserveSig] int ReplaceIcon(int i, IntPtr hicon, out int pi);
        [PreserveSig] int SetOverlayImage(int iImage, int iOverlay);
        [PreserveSig] int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
        [PreserveSig] int AddMasked(IntPtr hbmImage, int crMask, out int pi);
        [PreserveSig] int Draw(IntPtr pimldp);
        [PreserveSig] int Remove(int i);
        [PreserveSig] int GetIcon(int i, int flags, out IntPtr picon);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes,
        ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);

    [DllImport("shell32.dll", SetLastError = true)]
    private static extern int SHGetImageList(int iImageList, ref Guid riid, out IImageList ppv);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static int GetSizes(string path, out int jumboSize, out int extraSize)
    {
        jumboSize = 0;
        extraSize = 0;
        SHFILEINFO shfi = new SHFILEINFO();
        IntPtr result = SHGetFileInfo(path, 0, ref shfi, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), SHGFI_SYSICONINDEX);
        if (result == IntPtr.Zero) return 0;

        IImageList list;
        Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
        if (SHGetImageList(SHIL_JUMBO, ref iid, out list) == 0)
        {
            IntPtr hIcon;
            if (list.GetIcon(shfi.iIcon, ILD_TRANSPARENT, out hIcon) == 0)
            {
                using (Icon icon = Icon.FromHandle(hIcon))
                {
                    jumboSize = icon.Width;
                }
                DestroyIcon(hIcon);
            }
            Marshal.ReleaseComObject(list);
        }
        return shfi.iIcon;
    }

    public static string GetBase64(string path, int size)
    {
        SHFILEINFO shfi = new SHFILEINFO();
        IntPtr result = SHGetFileInfo(path, 0, ref shfi, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), SHGFI_SYSICONINDEX);
        if (result == IntPtr.Zero || shfi.iIcon < 0) return null;

        Guid iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
        IImageList list = null;
        int hr = SHGetImageList(SHIL_JUMBO, ref iid, out list);
        if (hr != 0 || list == null)
        {
            hr = SHGetImageList(SHIL_EXTRALARGE, ref iid, out list);
        }
        if (hr != 0 || list == null) return null;

        IntPtr hIcon = IntPtr.Zero;
        try
        {
            hr = list.GetIcon(shfi.iIcon, ILD_TRANSPARENT, out hIcon);
            if (hr != 0 || hIcon == IntPtr.Zero) return null;

            using (Icon source = Icon.FromHandle(hIcon))
            using (Bitmap bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            using (Graphics graphics = Graphics.FromImage(bitmap))
            using (MemoryStream stream = new MemoryStream())
            {
                graphics.Clear(Color.Transparent);
                graphics.CompositingMode = CompositingMode.SourceOver;
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.SmoothingMode = SmoothingMode.HighQuality;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                using (Bitmap original = source.ToBitmap())
                {
                    DrawTrimmed(graphics, original, size);
                }
                bitmap.Save(stream, ImageFormat.Png);
                return Convert.ToBase64String(stream.ToArray());
            }
        }
        finally
        {
            if (hIcon != IntPtr.Zero) DestroyIcon(hIcon);
            if (list != null) Marshal.ReleaseComObject(list);
        }
    }

    /// <summary>
    /// Some shell icons (notably small 16x16 resources inside large .ico files)
    /// come back from SHIL_JUMBO as a tiny image parked in the top-left corner
    /// of a 256x256 transparent canvas. Trim the transparent padding and fit
    /// the real artwork to the output tile.
    /// </summary>
    private static void DrawTrimmed(Graphics graphics, Bitmap original, int size)
    {
        Rectangle bounds = FindContentBounds(original);
        int padding = 3;
        int available = size - padding * 2;

        if (bounds.Width <= 2 || bounds.Height <= 2)
        {
            graphics.DrawImage(original, padding, padding, available, available);
            return;
        }

        double scale = Math.Min((double)available / bounds.Width, (double)available / bounds.Height);
        int drawWidth = Math.Max(1, (int)Math.Round(bounds.Width * scale));
        int drawHeight = Math.Max(1, (int)Math.Round(bounds.Height * scale));
        int drawX = (size - drawWidth) / 2;
        int drawY = (size - drawHeight) / 2;
        graphics.DrawImage(original, new Rectangle(drawX, drawY, drawWidth, drawHeight),
            bounds, GraphicsUnit.Pixel);
    }

    private static Rectangle FindContentBounds(Bitmap original)
    {
        int width = original.Width;
        int height = original.Height;
        Bitmap argb = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(argb))
        {
            g.Clear(Color.Transparent);
            g.DrawImage(original, 0, 0, width, height);
        }

        BitmapData data = argb.LockBits(new Rectangle(0, 0, width, height),
            ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int[] pixels = new int[width * height];
        try
        {
            Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        }
        finally
        {
            argb.UnlockBits(data);
        }

        int minX = width;
        int minY = height;
        int maxX = -1;
        int maxY = -1;
        for (int y = 0; y < height; y++)
        {
            int row = y * width;
            for (int x = 0; x < width; x++)
            {
                int alpha = (pixels[row + x] >> 24) & 0xFF;
                if (alpha > 6)
                {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        argb.Dispose();

        if (maxX < minX || maxY < minY)
        {
            return new Rectangle(0, 0, width, height);
        }
        return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }
}

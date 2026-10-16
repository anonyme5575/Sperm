using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace MoniteurPC;

/// <summary>
/// Sert la page et l'état en JSON (TCP 8790), et répond aux recherches de l'app Android
/// sur le réseau local (UDP 8791).
/// </summary>
public sealed class Server
{
    public const int DiscoveryPort = 8791;
    private readonly Func<Snapshot> _state;
    private readonly int _port;
    private readonly byte[] _page;
    private readonly HttpListener _http = new();

    public Server(int port, Func<Snapshot> state)
    {
        _port = port;
        _state = state;
        var asm = typeof(Server).Assembly;
        var res = asm.GetManifestResourceNames().First(n => n.EndsWith("index.html", StringComparison.OrdinalIgnoreCase));
        using var ms = new MemoryStream();
        asm.GetManifestResourceStream(res)!.CopyTo(ms);
        _page = ms.ToArray();
    }

    public void Start()
    {
        _http.Prefixes.Add($"http://+:{_port}/");
        _http.Start();
        new Thread(HttpLoop) { IsBackground = true, Name = "HTTP" }.Start();
        new Thread(DiscoveryLoop) { IsBackground = true, Name = "Découverte" }.Start();
    }

    public void Stop()
    {
        try { _http.Stop(); } catch { }
    }

    private void HttpLoop()
    {
        while (_http.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = _http.GetContext(); }
            catch { return; }
            ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
        }
    }

    private void Handle(HttpListenerContext ctx)
    {
        try
        {
            string path = ctx.Request.Url?.AbsolutePath ?? "/";
            byte[] body;
            string type;
            int code = 200;
            if (path == "/api/etat")
            {
                body = JsonSerializer.SerializeToUtf8Bytes(_state());
                type = "application/json";
            }
            else if (path is "/" or "/index.html")
            {
                body = _page;
                type = "text/html; charset=utf-8";
            }
            else
            {
                code = 404;
                body = Encoding.UTF8.GetBytes("{\"erreur\":\"introuvable\"}");
                type = "application/json";
            }
            ctx.Response.StatusCode = code;
            ctx.Response.ContentType = type;
            ctx.Response.Headers["Cache-Control"] = "no-store";
            ctx.Response.ContentLength64 = body.Length;
            ctx.Response.OutputStream.Write(body);
        }
        catch { }
        finally
        {
            try { ctx.Response.Close(); } catch { }
        }
    }

    /// <summary>L'app envoie « MONITEURPC? » en diffusion ; on répond « MONITEURPC|port|nom du PC ».</summary>
    private void DiscoveryLoop()
    {
        try
        {
            using var udp = new UdpClient(new IPEndPoint(IPAddress.Any, DiscoveryPort));
            var reply = Encoding.UTF8.GetBytes($"MONITEURPC|{_port}|{Environment.MachineName}");
            while (true)
            {
                var from = new IPEndPoint(IPAddress.Any, 0);
                byte[] msg = udp.Receive(ref from);
                if (Encoding.UTF8.GetString(msg).StartsWith("MONITEURPC?"))
                    udp.Send(reply, reply.Length, from);
            }
        }
        catch { /* port occupé : l'app reste joignable en tapant l'adresse */ }
    }
}

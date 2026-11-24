package com.xianinproduction.xerotv;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class LocalXeroServer {

    private static final String TMDB_BASE_URL = "https://api.themoviedb.org/3";
    private static final String TMDB_READ_TOKEN =
            "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIyM2JmYjg4ZmRkMGYyYWIyZDViZTdkN2JhYjAwNDA2NSIsIm5iZiI6MTc5NDQ5NzA2MC42MjQsInN1YiI6IjZhZjVkYTI0NzNhYmYxYzg5YjJiZGZmYSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ygPWQOs_w9L5obHG6T36n5Y03AAHsoMC_WnL1GEnfqw";
    private static final String ADMIN_ACCESS_CODE = "xiancondino";
    private static final int MAX_CHUNK_BYTES = 1572864;

    private static final String[] OPEN_STREAMS_HD = {
            "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
            "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4",
            "https://archive.org/download/ElephantsDream/ed_hd_512kb.mp4",
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
    };

    private static final String[] OPEN_STREAMS_COMPACT = {
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
            "https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4",
            "https://archive.org/download/ElephantsDream/ed_hd_512kb.mp4",
            "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4"
    };

    private static final int LOCAL_FALLBACK_MIRROR_INDEX = 999;

    private final AssetManager assets;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Integer> botChallenges = new ConcurrentHashMap<>();
    private final Map<String, Long> adminSessions = new ConcurrentHashMap<>();

    private ServerSocket serverSocket;
    private volatile boolean running = false;
    private int port = 28492;

    public LocalXeroServer(AssetManager assets) {
        this.assets = assets;
    }

    public int start() throws IOException {
        if (running && serverSocket != null && !serverSocket.isClosed()) {
            return port;
        }
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        ServerSocket sock = null;
        int[] candidatePorts = {28492, 28493, 28494, 28495, 0};
        for (int candidate : candidatePorts) {
            try {
                sock = new ServerSocket(candidate, 64, loopback);
                port = sock.getLocalPort();
                break;
            } catch (IOException ignored) {
            }
        }
        if (sock == null) {
            sock = new ServerSocket(0, 64, loopback);
            port = sock.getLocalPort();
        }
        serverSocket = sock;
        running = true;

        Thread acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                while (running && serverSocket != null && !serverSocket.isClosed()) {
                    try {
                        final Socket client = serverSocket.accept();
                        workers.execute(new Runnable() {
                            @Override
                            public void run() {
                                handleClient(client);
                            }
                        });
                    } catch (IOException ignored) {
                        if (!running) break;
                    }
                }
            }
        }, "XeroLocalAccept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return port;
    }

    public void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
            }
        }
    }

    public int getPort() {
        return port;
    }

    private void handleClient(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(20000);
            BufferedInputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();

            String requestLine = readLineAscii(in);
            if (requestLine == null || requestLine.isEmpty()) {
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                return;
            }
            String method = parts[0].toUpperCase(Locale.US);
            String rawTarget = parts[1];

            Map<String, String> headers = new HashMap<>();
            String hLine;
            while ((hLine = readLineAscii(in)) != null && !hLine.isEmpty()) {
                int idx = hLine.indexOf(':');
                if (idx > 0) {
                    headers.put(hLine.substring(0, idx).trim().toLowerCase(Locale.US),
                            hLine.substring(idx + 1).trim());
                }
            }

            byte[] bodyBytes = new byte[0];
            String clHeader = headers.get("content-length");
            if (clHeader != null) {
                try {
                    int len = Math.min(1048576, Math.max(0, Integer.parseInt(clHeader)));
                    bodyBytes = new byte[len];
                    int readTotal = 0;
                    while (readTotal < len) {
                        int n = in.read(bodyBytes, readTotal, len - readTotal);
                        if (n <= 0) break;
                        readTotal += n;
                    }
                } catch (Exception ignored) {
                }
            }

            int qIdx = rawTarget.indexOf('?');
            String path = qIdx >= 0 ? rawTarget.substring(0, qIdx) : rawTarget;
            String queryStr = qIdx >= 0 ? rawTarget.substring(qIdx + 1) : "";
            Map<String, String> query = parseQuery(queryStr);

            if (path.startsWith("/api/")) {
                handleApi(method, path, query, headers, bodyBytes, out);
            } else {
                handleStaticAsset(path, headers, out);
            }
        } catch (Exception ignored) {
        }
    }

    private void handleStaticAsset(String reqPath, Map<String, String> headers, OutputStream out) throws IOException {
        String clean = reqPath;
        if (clean.equals("/") || clean.isEmpty()) {
            clean = "/index.html";
        }
        // Prevent path traversal
        if (clean.contains("..")) {
            sendJson(out, 400, "{\"error\":\"Invalid path\"}");
            return;
        }
        String assetPath = "www" + clean;
        if (!assetExists(assetPath)) {
            // SPA fallback to www/index.html for clean routes
            assetPath = "www/index.html";
        }
        String mime = guessMime(assetPath);
        serveAsset(assetPath, mime, headers.get("range"), out);
    }

    private boolean assetExists(String assetPath) {
        try (InputStream is = assets.open(assetPath)) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private void serveAsset(String assetPath, String mime, String rangeHeader, OutputStream out) throws IOException {
        long fileSize = -1;
        try (AssetFileDescriptor afd = assets.openFd(assetPath)) {
            fileSize = afd.getLength();
        } catch (IOException ignored) {
        }

        if (fileSize < 0) {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            try (InputStream is = assets.open(assetPath)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = is.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
            }
            byte[] data = baos.toByteArray();
            if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                long[] se = parseByteRange(rangeHeader, data.length);
                int start = (int) se[0];
                int end = (int) se[1];
                int chunk = end - start + 1;
                StringBuilder hdr = new StringBuilder();
                hdr.append("HTTP/1.1 206 Partial Content\r\n");
                hdr.append("Content-Type: ").append(mime).append("\r\n");
                hdr.append("Content-Length: ").append(chunk).append("\r\n");
                hdr.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(data.length).append("\r\n");
                hdr.append("Accept-Ranges: bytes\r\nConnection: close\r\n\r\n");
                out.write(hdr.toString().getBytes(StandardCharsets.US_ASCII));
                out.write(data, start, chunk);
                out.flush();
                return;
            }
            sendBytes(out, 200, mime, data);
            return;
        }

        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            long[] se = parseByteRange(rangeHeader, fileSize);
            long start = se[0];
            long end = se[1];
            long len = end - start + 1;

            StringBuilder hdr = new StringBuilder();
            hdr.append("HTTP/1.1 206 Partial Content\r\n");
            hdr.append("Content-Type: ").append(mime).append("\r\n");
            hdr.append("Content-Length: ").append(len).append("\r\n");
            hdr.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(fileSize).append("\r\n");
            hdr.append("Accept-Ranges: bytes\r\nCache-Control: public, max-age=3600\r\nConnection: close\r\n\r\n");
            out.write(hdr.toString().getBytes(StandardCharsets.US_ASCII));

            try (InputStream is = assets.open(assetPath)) {
                skipFully(is, start);
                copyBounded(is, out, len);
            }
            out.flush();
            return;
        }

        StringBuilder hdr = new StringBuilder();
        hdr.append("HTTP/1.1 200 OK\r\n");
        hdr.append("Content-Type: ").append(mime).append("\r\n");
        hdr.append("Content-Length: ").append(fileSize).append("\r\n");
        hdr.append("Accept-Ranges: bytes\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n");
        out.write(hdr.toString().getBytes(StandardCharsets.US_ASCII));

        try (InputStream is = assets.open(assetPath)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        }
        out.flush();
    }

    private void handleApi(String method, String path, Map<String, String> query,
                           Map<String, String> headers, byte[] body, OutputStream out) throws IOException {
        try {
            if (path.equals("/api/health")) {
                sendJson(out, 200, "{\"ok\":true,\"service\":\"XEROTV\",\"version\":\"1.0\",\"developer\":\"XIAN IN PRODUCTION\",\"runtime\":\"android\"}");
                return;
            }
            if (path.equals("/api/speedtest/ping")) {
                sendJson(out, 200, "{\"ok\":true,\"serverTimeMs\":" + System.currentTimeMillis() + "}");
                return;
            }
            if (path.equals("/api/speedtest/payload")) {
                int reqBytes = parseIntSafe(query.get("bytes"), 262144);
                int size = Math.max(1024, Math.min(2097152, reqBytes));
                byte[] buf = new byte[size];
                for (int i = 0; i < size; i += 4096) {
                    buf[i] = (byte) ((i * 31) & 0xff);
                }
                sendBytes(out, 200, "application/octet-stream", buf);
                return;
            }
            if (path.equals("/api/media/improving-v1.mp4")) {
                serveAsset("www/media/improving-v1.mp4", "video/mp4", headers.get("range"), out);
                return;
            }
            if (path.equals("/api/security/bot-challenge")) {
                int a = 3 + random.nextInt(15);
                int b = 1 + random.nextInt(9);
                boolean sub = random.nextBoolean() && a > b;
                int expected = sub ? (a - b) : (a + b);
                byte[] tokenRaw = new byte[12];
                random.nextBytes(tokenRaw);
                String tok = toHex(tokenRaw);
                botChallenges.put(tok, expected);
                JSONObject res = new JSONObject();
                res.put("question", "Human Check: What is " + a + (sub ? " - " : " + ") + b + "?");
                res.put("challengeToken", tok);
                sendJson(out, 200, res.toString());
                return;
            }
            if (path.equals("/api/security/bot-verify") && method.equals("POST")) {
                JSONObject reqJson = new JSONObject(new String(body, StandardCharsets.UTF_8));
                String tok = reqJson.optString("challengeToken", "");
                String ans = reqJson.optString("answer", "").trim();
                Integer expected = botChallenges.remove(tok);
                if (expected == null || !String.valueOf(expected).equals(ans)) {
                    sendJson(out, 400, "{\"verified\":false,\"error\":\"Incorrect answer. Please solve the math check.\"}");
                    return;
                }
                byte[] bTok = new byte[16];
                random.nextBytes(bTok);
                sendJson(out, 200, "{\"verified\":true,\"botToken\":\"" + toHex(bTok) + "\"}");
                return;
            }
            if (path.equals("/api/admin/verify") && method.equals("POST")) {
                JSONObject reqJson = new JSONObject(new String(body, StandardCharsets.UTF_8));
                String provided = reqJson.optString("accessCode", "");
                if (!ADMIN_ACCESS_CODE.equals(provided)) {
                    sendJson(out, 401, "{\"verified\":false,\"error\":\"Invalid developer access code.\"}");
                    return;
                }
                byte[] sBytes = new byte[20];
                random.nextBytes(sBytes);
                String sessionTok = toHex(sBytes);
                adminSessions.put(sessionTok, System.currentTimeMillis() + 43200000L);
                sendJson(out, 200, "{\"verified\":true,\"token\":\"" + sessionTok + "\"}");
                return;
            }
            if (path.equals("/api/admin/status")) {
                String auth = headers.getOrDefault("authorization", "");
                String tok = auth.startsWith("Bearer ") ? auth.substring(7).trim() : "";
                Long exp = adminSessions.get(tok);
                boolean ok = exp != null && exp > System.currentTimeMillis();
                sendJson(out, 200, "{\"verified\":" + ok + "}");
                return;
            }
            if (path.equals("/api/admin/logout")) {
                sendJson(out, 200, "{\"ok\":true}");
                return;
            }
            if (path.equals("/api/tmdb/feed")) {
                handleTmdbFeed(query, out);
                return;
            }
            if (path.equals("/api/tmdb/search")) {
                handleTmdbSearch(query, out);
                return;
            }
            if (path.equals("/api/tmdb/discover")) {
                handleTmdbDiscover(query, out);
                return;
            }
            if (path.equals("/api/tmdb/studios")) {
                handleTmdbStudios(query, out);
                return;
            }
            if (path.equals("/api/tmdb/releases")) {
                handleTmdbReleases(out);
                return;
            }
            if (path.startsWith("/api/tmdb/details/")) {
                String[] segs = path.substring("/api/tmdb/details/".length()).split("/");
                if (segs.length >= 2) {
                    String mediaType = "tv".equals(segs[0]) ? "tv" : "movie";
                    int id = parseIntSafe(segs[1], 0);
                    JSONObject data = tmdbFetch("/" + mediaType + "/" + id + "?language=en-US&append_to_response=credits,videos,recommendations,similar,release_dates,content_ratings");
                    data.put("media_type", mediaType);
                    sendJson(out, 200, data.toString());
                    return;
                }
            }
            if (path.startsWith("/api/tmdb/season/")) {
                String[] segs = path.substring("/api/tmdb/season/".length()).split("/");
                if (segs.length >= 2) {
                    int tvId = parseIntSafe(segs[0], 0);
                    int seasonNum = parseIntSafe(segs[1], 1);
                    JSONObject data = tmdbFetch("/tv/" + tvId + "/season/" + seasonNum + "?language=en-US");
                    sendJson(out, 200, data.toString());
                    return;
                }
            }
            if (path.equals("/api/download/info")) {
                handleDownloadInfo(query, out);
                return;
            }
            if (path.equals("/api/download/stream")) {
                handleDownloadStream(query, headers, out);
                return;
            }
            sendJson(out, 404, "{\"error\":\"Endpoint not found\"}");
        } catch (Exception e) {
            JSONObject err = new JSONObject();
            try {
                err.put("error", e.getMessage() != null ? e.getMessage() : "Upstream error");
            } catch (Exception ignored) {
            }
            sendJson(out, 502, err.toString());
        }
    }

    private JSONObject tmdbFetch(String pathAndQuery) throws Exception {
        String sep = pathAndQuery.contains("?") ? "&" : "?";
        String full = TMDB_BASE_URL + pathAndQuery + (pathAndQuery.contains("language=") ? "" : sep + "language=en-US");
        HttpURLConnection conn = (HttpURLConnection) new URL(full).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(12000);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + TMDB_READ_TOKEN);
        int status = conn.getResponseCode();
        InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = is != null ? readAllUtf8(is) : "{}";
        conn.disconnect();
        if (status >= 400) {
            throw new IOException("TMDB API " + status);
        }
        return new JSONObject(text);
    }

    private JSONArray tagItems(JSONArray raw, String defaultMediaType, boolean filterAdult) {
        JSONArray out = new JSONArray();
        if (raw == null) return out;
        for (int i = 0; i < raw.length(); i++) {
            JSONObject obj = raw.optJSONObject(i);
            if (obj == null) continue;
            if ("person".equals(obj.optString("media_type"))) continue;
            if (filterAdult && obj.optBoolean("adult", false)) continue;
            try {
                JSONObject copy = new JSONObject(obj.toString());
                if (defaultMediaType != null) {
                    copy.put("media_type", defaultMediaType);
                } else if (!copy.has("media_type") || copy.isNull("media_type")) {
                    copy.put("media_type", "movie");
                }
                out.put(copy);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    private void handleTmdbFeed(Map<String, String> query, OutputStream out) throws Exception {
        String mode = query.getOrDefault("mode", "main");
        int page = Math.max(1, Math.min(20, parseIntSafe(query.get("page"), 1)));

        if ("kids".equals(mode)) {
            Future<JSONObject> f1 = workers.submit(() -> tmdbFetch("/discover/movie?language=en-US&page=" + page + "&include_adult=false&certification_country=US&certification.lte=PG&with_genres=16%7C10751&sort_by=popularity.desc"));
            Future<JSONObject> f2 = workers.submit(() -> tmdbFetch("/discover/movie?language=en-US&page=" + page + "&include_adult=false&with_genres=16&vote_count.gte=50&sort_by=vote_average.desc"));
            Future<JSONObject> f3 = workers.submit(() -> tmdbFetch("/discover/tv?language=en-US&page=" + page + "&include_adult=false&with_genres=10762,16&sort_by=popularity.desc"));

            JSONArray sections = new JSONArray();
            sections.put(new JSONObject().put("id", "featured").put("title", "Kids PG Cinema").put("items", tagItems(f1.get().optJSONArray("results"), "movie", true)));
            sections.put(new JSONObject().put("id", "animated").put("title", "Animated Adventures").put("items", tagItems(f2.get().optJSONArray("results"), "movie", true)));
            sections.put(new JSONObject().put("id", "series").put("title", "Family & Kids Series").put("items", tagItems(f3.get().optJSONArray("results"), "tv", true)));
            sendJson(out, 200, new JSONObject().put("mode", mode).put("sections", sections).toString());
            return;
        }

        if ("adult".equals(mode)) {
            Future<JSONObject> f1 = workers.submit(() -> tmdbFetch("/discover/movie?language=en-US&page=" + page + "&include_adult=true&certification_country=US&certification.gte=R&with_genres=10749,18&sort_by=popularity.desc"));
            Future<JSONObject> f2 = workers.submit(() -> tmdbFetch("/discover/movie?language=en-US&page=" + page + "&include_adult=true&certification_country=US&certification.gte=R&with_genres=53,80&sort_by=popularity.desc"));
            Future<JSONObject> f3 = workers.submit(() -> tmdbFetch("/discover/tv?language=en-US&page=" + page + "&include_adult=true&with_genres=18,80&vote_count.gte=100&sort_by=popularity.desc"));

            JSONArray sections = new JSONArray();
            sections.put(new JSONObject().put("id", "featured").put("title", "18+ Mature & Romance").put("items", tagItems(f1.get().optJSONArray("results"), "movie", false)));
            sections.put(new JSONObject().put("id", "thriller").put("title", "R-Rated Thrillers & Noir").put("items", tagItems(f2.get().optJSONArray("results"), "movie", false)));
            sections.put(new JSONObject().put("id", "series").put("title", "Uncut Mature Series").put("items", tagItems(f3.get().optJSONArray("results"), "tv", false)));
            sendJson(out, 200, new JSONObject().put("mode", mode).put("sections", sections).toString());
            return;
        }

        if ("christmas".equals(mode)) {
            Future<JSONObject> f1 = workers.submit(() -> tmdbFetch("/discover/movie?language=en-US&page=" + page + "&include_adult=false&with_keywords=207317&sort_by=popularity.desc"));
            Future<JSONObject> f2 = workers.submit(() -> tmdbFetch("/search/movie?language=en-US&query=Christmas&page=" + page + "&include_adult=false"));
            Future<JSONObject> f3 = workers.submit(() -> tmdbFetch("/discover/tv?language=en-US&page=" + page + "&include_adult=false&with_keywords=207317&sort_by=popularity.desc"));

            JSONArray sections = new JSONArray();
            sections.put(new JSONObject().put("id", "featured").put("title", "Christmas Spotlight").put("items", tagItems(f1.get().optJSONArray("results"), "movie", true)));
            sections.put(new JSONObject().put("id", "santa").put("title", "Santa & Holiday Classics").put("items", tagItems(f2.get().optJSONArray("results"), "movie", true)));
            sections.put(new JSONObject().put("id", "series").put("title", "Winter Holiday Specials").put("items", tagItems(f3.get().optJSONArray("results"), "tv", true)));
            sendJson(out, 200, new JSONObject().put("mode", mode).put("sections", sections).toString());
            return;
        }

        Future<JSONObject> f1 = workers.submit(() -> tmdbFetch("/trending/all/week?language=en-US&page=" + page + "&include_adult=false"));
        Future<JSONObject> f2 = workers.submit(() -> tmdbFetch("/movie/popular?language=en-US&page=" + page + "&include_adult=false"));
        Future<JSONObject> f3 = workers.submit(() -> tmdbFetch("/movie/now_playing?language=en-US&page=" + page + "&include_adult=false"));
        Future<JSONObject> f4 = workers.submit(() -> tmdbFetch("/tv/top_rated?language=en-US&page=" + page + "&include_adult=false"));

        JSONArray sections = new JSONArray();
        sections.put(new JSONObject().put("id", "featured").put("title", "Trending Worldwide").put("items", tagItems(f1.get().optJSONArray("results"), null, true)));
        sections.put(new JSONObject().put("id", "popular").put("title", "Popular Cinema").put("items", tagItems(f2.get().optJSONArray("results"), "movie", true)));
        sections.put(new JSONObject().put("id", "now_playing").put("title", "Now Playing in Theaters").put("items", tagItems(f3.get().optJSONArray("results"), "movie", true)));
        sections.put(new JSONObject().put("id", "series").put("title", "Acclaimed Series").put("items", tagItems(f4.get().optJSONArray("results"), "tv", true)));
        sendJson(out, 200, new JSONObject().put("mode", "main").put("sections", sections).toString());
    }

    private void handleTmdbSearch(Map<String, String> query, OutputStream out) throws Exception {
        String q = query.getOrDefault("query", "").trim();
        String mode = query.getOrDefault("mode", "main");
        int page = Math.max(1, Math.min(20, parseIntSafe(query.get("page"), 1)));
        if (q.isEmpty()) {
            sendJson(out, 200, "{\"results\":[]}");
            return;
        }
        String enc = URLEncoder.encode(q, "UTF-8");
        JSONObject data = tmdbFetch("/search/multi?language=en-US&query=" + enc + "&page=" + page + "&include_adult=" + ("adult".equals(mode)));
        JSONArray raw = data.optJSONArray("results");
        JSONArray filtered = new JSONArray();
        if (raw != null) {
            for (int i = 0; i < raw.length(); i++) {
                JSONObject item = raw.optJSONObject(i);
                if (item == null) continue;
                String mt = item.optString("media_type");
                if (!"movie".equals(mt) && !"tv".equals(mt)) continue;
                if (!"adult".equals(mode) && item.optBoolean("adult", false)) continue;
                if ("kids".equals(mode)) {
                    JSONArray gids = item.optJSONArray("genre_ids");
                    boolean blocked = false;
                    if (gids != null) {
                        for (int j = 0; j < gids.length(); j++) {
                            int g = gids.optInt(j);
                            if (g == 27 || g == 53 || g == 80 || g == 10752) blocked = true;
                        }
                    }
                    if (blocked) continue;
                }
                filtered.put(item);
            }
        }
        sendJson(out, 200, new JSONObject().put("results", filtered).toString());
    }

    private void handleTmdbDiscover(Map<String, String> query, OutputStream out) throws Exception {
        String mediaType = "tv".equals(query.get("mediaType")) ? "tv" : "movie";
        String genre = query.getOrDefault("genre", "");
        String mode = query.getOrDefault("mode", "main");
        int page = Math.max(1, Math.min(20, parseIntSafe(query.get("page"), 1)));

        StringBuilder ep = new StringBuilder("/discover/" + mediaType + "?language=en-US&page=" + page
                + "&include_adult=" + ("adult".equals(mode)) + "&sort_by=popularity.desc");
        if (!genre.isEmpty()) {
            ep.append("&with_genres=").append(URLEncoder.encode(genre, "UTF-8"));
        }
        if ("kids".equals(mode)) {
            if ("movie".equals(mediaType)) {
                ep.append("&certification_country=US&certification.lte=PG");
            }
            if (genre.isEmpty()) {
                ep.append("&with_genres=").append("tv".equals(mediaType) ? "10762%7C16%7C10751" : "16%7C10751");
            }
        }
        if ("christmas".equals(mode)) {
            ep.append("&with_keywords=207317");
        }
        JSONObject data = tmdbFetch(ep.toString());
        sendJson(out, 200, new JSONObject().put("results", tagItems(data.optJSONArray("results"), mediaType, !"adult".equals(mode))).toString());
    }

    private void handleTmdbStudios(Map<String, String> query, OutputStream out) throws Exception {
        String studio = query.getOrDefault("studio", "netflix").toLowerCase(Locale.US);
        String mode = query.getOrDefault("mode", "main");
        String typeFilter = query.getOrDefault("type", "all").toLowerCase(Locale.US);
        int page = Math.max(1, Math.min(10, parseIntSafe(query.get("page"), 1)));

        String name = "Netflix";
        String movieFilter = "with_watch_providers=8&watch_region=US";
        String tvFilter = "with_networks=213";
        switch (studio) {
            case "disney": name = "Disney+"; movieFilter = "with_watch_providers=337&watch_region=US"; tvFilter = "with_networks=2739"; break;
            case "hbo": name = "HBO / Max"; movieFilter = "with_watch_providers=1899%7C384&watch_region=US"; tvFilter = "with_networks=49%7C3186"; break;
            case "apple": name = "Apple TV+"; movieFilter = "with_watch_providers=350&watch_region=US"; tvFilter = "with_networks=2552"; break;
            case "prime": name = "Prime Video"; movieFilter = "with_watch_providers=9%7C119&watch_region=US"; tvFilter = "with_networks=1024"; break;
            case "marvel": name = "Marvel Studios"; movieFilter = "with_companies=420"; tvFilter = "with_companies=420%7C13252"; break;
            case "pixar": name = "Pixar"; movieFilter = "with_companies=3"; tvFilter = "with_companies=3"; break;
            case "warner": name = "Warner Bros."; movieFilter = "with_companies=174"; tvFilter = "with_companies=1957%7C174"; break;
            case "a24": name = "A24"; movieFilter = "with_companies=41077"; tvFilter = "with_companies=41077"; break;
            default: break;
        }

        boolean wantMovies = !"tv".equals(typeFilter);
        boolean wantTv = !"movie".equals(typeFilter);
        String kidsMovieParam = "kids".equals(mode) ? "&certification_country=US&certification.lte=PG&without_genres=27,53,80,10752" : "";
        String kidsTvParam = "kids".equals(mode) ? "&without_genres=27,80,10768" : "";

        Future<JSONObject> fMovies = wantMovies
                ? workers.submit(() -> {
                    try {
                        return tmdbFetch("/discover/movie?language=en-US&page=" + page + "&sort_by=popularity.desc&" + movieFilter + "&include_adult=" + ("adult".equals(mode)) + kidsMovieParam);
                    } catch (Exception e) {
                        return new JSONObject();
                    }
                })
                : null;

        Future<JSONObject> fTv = wantTv
                ? workers.submit(() -> {
                    try {
                        return tmdbFetch("/discover/tv?language=en-US&page=" + page + "&sort_by=popularity.desc&" + tvFilter + "&include_adult=" + ("adult".equals(mode)) + kidsTvParam);
                    } catch (Exception e) {
                        return new JSONObject();
                    }
                })
                : null;

        JSONArray moviesArr = fMovies != null ? tagItems(fMovies.get().optJSONArray("results"), "movie", !"adult".equals(mode)) : new JSONArray();
        JSONArray tvArr = fTv != null ? tagItems(fTv.get().optJSONArray("results"), "tv", !"adult".equals(mode)) : new JSONArray();

        JSONArray combined = new JSONArray();
        int maxLen = Math.max(moviesArr.length(), tvArr.length());
        for (int i = 0; i < maxLen; i++) {
            if (i < moviesArr.length()) combined.put(moviesArr.get(i));
            if (i < tvArr.length()) combined.put(tvArr.get(i));
        }

        JSONObject res = new JSONObject();
        res.put("studio", studio);
        res.put("name", name);
        res.put("mediaType", ("movie".equals(typeFilter) || "tv".equals(typeFilter)) ? typeFilter : "mixed");
        res.put("movieCount", moviesArr.length());
        res.put("tvCount", tvArr.length());
        res.put("results", combined);
        sendJson(out, 200, res.toString());
    }

    private void handleTmdbReleases(OutputStream out) throws Exception {
        Future<JSONObject> f1 = workers.submit(() -> tmdbFetch("/movie/now_playing?language=en-US&page=1&include_adult=false"));
        Future<JSONObject> f2 = workers.submit(() -> tmdbFetch("/tv/airing_today?language=en-US&page=1&include_adult=false"));
        JSONArray releases = new JSONArray();
        JSONArray movies = tagItems(f1.get().optJSONArray("results"), "movie", true);
        JSONArray tv = tagItems(f2.get().optJSONArray("results"), "tv", true);
        for (int i = 0; i < Math.min(4, movies.length()); i++) releases.put(movies.get(i));
        for (int i = 0; i < Math.min(3, tv.length()); i++) releases.put(tv.get(i));
        sendJson(out, 200, new JSONObject().put("releases", releases).toString());
    }

    private void handleDownloadInfo(Map<String, String> query, OutputStream out) throws Exception {
        int tmdbId = Math.abs(parseIntSafe(query.get("tmdbId"), 1));
        String quality = query.getOrDefault("quality", "standard");
        String title = query.getOrDefault("title", "xerotv-movie").replaceAll("[^a-zA-Z0-9_-]+", "-");
        if (title.length() > 48) title = title.substring(0, 48);

        String[] pool = "hd".equals(quality) ? OPEN_STREAMS_HD : OPEN_STREAMS_COMPACT;
        int startIdx = tmdbId % pool.length;

        for (int off = 0; off < pool.length; off++) {
            int idx = (startIdx + off) % pool.length;
            String candidate = pool[idx];
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(candidate).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(7000);
                conn.setReadTimeout(7000);
                conn.setRequestProperty("Range", "bytes=0-0");
                int status = conn.getResponseCode();
                if (status == 200 || status == 206) {
                    long total = parseContentRangeTotal(conn.getHeaderField("Content-Range"));
                    if (total <= 0) {
                        total = conn.getContentLengthLong();
                    }
                    String ct = conn.getContentType();
                    if (ct == null || ct.isEmpty()) ct = "video/mp4";
                    if (total > 0) {
                        JSONObject info = new JSONObject();
                        info.put("ok", true);
                        info.put("mirrorIndex", idx);
                        info.put("totalBytes", total);
                        info.put("contentType", ct);
                        info.put("chunkBytes", MAX_CHUNK_BYTES);
                        info.put("filename", title + "-" + tmdbId + ".mp4");
                        sendJson(out, 200, info.toString());
                        return;
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
        try (AssetFileDescriptor afd = assets.openFd("www/media/improving-v1.mp4")) {
            long localSize = afd.getLength();
            if (localSize > 0) {
                JSONObject info = new JSONObject();
                info.put("ok", true);
                info.put("mirrorIndex", LOCAL_FALLBACK_MIRROR_INDEX);
                info.put("totalBytes", localSize);
                info.put("contentType", "video/mp4");
                info.put("chunkBytes", MAX_CHUNK_BYTES);
                info.put("filename", title + "-" + tmdbId + ".mp4");
                sendJson(out, 200, info.toString());
                return;
            }
        } catch (Exception ignored) {
        }
        sendJson(out, 502, "{\"error\":\"No upstream video mirror is currently reachable.\"}");
    }

    private void handleDownloadStream(Map<String, String> query, Map<String, String> headers, OutputStream out) throws Exception {
        int tmdbId = Math.abs(parseIntSafe(query.get("tmdbId"), 1));
        String quality = query.getOrDefault("quality", "standard");
        int mirrorParam = parseIntSafe(query.get("mirrorIndex"), -1);
        String[] pool = "hd".equals(quality) ? OPEN_STREAMS_HD : OPEN_STREAMS_COMPACT;
        int baseIdx = mirrorParam >= 0 ? (mirrorParam % pool.length) : (tmdbId % pool.length);

        boolean hasExplicit = query.containsKey("start") && query.containsKey("end");
        String rangeHeader = null;
        if (hasExplicit) {
            long start = Math.max(0L, parseLongSafe(query.get("start"), 0L));
            long reqEnd = Math.max(start, parseLongSafe(query.get("end"), start));
            long cappedEnd = Math.min(reqEnd, start + MAX_CHUNK_BYTES - 1L);
            rangeHeader = "bytes=" + start + "-" + cappedEnd;
        } else if (headers.containsKey("range")) {
            rangeHeader = headers.get("range");
        }

        if (mirrorParam == LOCAL_FALLBACK_MIRROR_INDEX) {
            serveAsset("www/media/improving-v1.mp4", "video/mp4", rangeHeader, out);
            return;
        }

        String urlStr = pool[baseIdx];
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        if (rangeHeader != null) {
            conn.setRequestProperty("Range", rangeHeader);
        }
        int status = conn.getResponseCode();
        if (status < 200 || status >= 300) {
            conn.disconnect();
            sendJson(out, 502, "{\"error\":\"Upstream mirror error HTTP " + status + "\"}");
            return;
        }

        String ct = conn.getContentType();
        if (ct == null || ct.isEmpty()) ct = "video/mp4";
        String cr = conn.getHeaderField("Content-Range");
        long cl = conn.getContentLengthLong();

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (InputStream is = conn.getInputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
        }
        conn.disconnect();
        byte[] data = baos.toByteArray();

        StringBuilder hdr = new StringBuilder();
        hdr.append("HTTP/1.1 ").append(status).append(status == 206 ? " Partial Content\r\n" : " OK\r\n");
        hdr.append("Content-Type: ").append(ct).append("\r\n");
        hdr.append("Content-Length: ").append(cl >= 0 ? data.length : data.length).append("\r\n");
        if (cr != null) hdr.append("Content-Range: ").append(cr).append("\r\n");
        hdr.append("Accept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
        out.write(hdr.toString().getBytes(StandardCharsets.US_ASCII));
        out.write(data);
        out.flush();
    }

    private static long parseContentRangeTotal(String headerValue) {
        if (headerValue == null) return 0L;
        int idx = headerValue.lastIndexOf('/');
        if (idx < 0) return 0L;
        try {
            return Long.parseLong(headerValue.substring(idx + 1).trim());
        } catch (Exception e) {
            return 0L;
        }
    }

    private static long[] parseByteRange(String rangeHeader, long fileSize) {
        String val = rangeHeader.substring("bytes=".length()).trim();
        int dash = val.indexOf('-');
        long start = 0;
        long end = fileSize - 1;
        if (dash >= 0) {
            String sPart = val.substring(0, dash).trim();
            String ePart = val.substring(dash + 1).trim();
            if (!sPart.isEmpty()) start = Math.max(0, Long.parseLong(sPart));
            if (!ePart.isEmpty()) end = Math.min(fileSize - 1, Long.parseLong(ePart));
        }
        if (end < start) end = Math.min(fileSize - 1, start);
        return new long[]{start, end};
    }

    private static void skipFully(InputStream is, long n) throws IOException {
        long rem = n;
        while (rem > 0) {
            long skipped = is.skip(rem);
            if (skipped <= 0) {
                if (is.read() == -1) break;
                rem--;
            } else {
                rem -= skipped;
            }
        }
    }

    private static void copyBounded(InputStream is, OutputStream out, long len) throws IOException {
        byte[] buf = new byte[16384];
        long rem = len;
        while (rem > 0) {
            int toRead = (int) Math.min(buf.length, rem);
            int n = is.read(buf, 0, toRead);
            if (n == -1) break;
            out.write(buf, 0, n);
            rem -= n;
        }
    }

    private static String guessMime(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    private static void sendJson(OutputStream out, int code, String json) throws IOException {
        sendBytes(out, code, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
    }

    private static void sendBytes(OutputStream out, int code, String mime, byte[] data) throws IOException {
        String reason = code == 200 ? "OK" : (code == 400 ? "Bad Request" : (code == 401 ? "Unauthorized" : (code == 404 ? "Not Found" : "Error")));
        String hdr = "HTTP/1.1 " + code + " " + reason + "\r\n"
                + "Content-Type: " + mime + "\r\n"
                + "Content-Length: " + data.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n\r\n";
        out.write(hdr.getBytes(StandardCharsets.US_ASCII));
        out.write(data);
        out.flush();
    }

    private static String readLineAscii(InputStream in) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        int prev = -1;
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (prev == '\r') {
                baos.write('\r');
            }
            if (c != '\r') {
                baos.write(c);
            }
            prev = c;
        }
        if (c == -1 && baos.size() == 0) return null;
        return baos.toString("US-ASCII");
    }

    private static String readAllUtf8(InputStream is) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) != -1) {
            baos.write(buf, 0, n);
        }
        return baos.toString("UTF-8");
    }

    private static Map<String, String> parseQuery(String q) {
        Map<String, String> map = new HashMap<>();
        if (q == null || q.isEmpty()) return map;
        for (String pair : q.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                try {
                    String k = URLDecoder.decode(pair.substring(0, eq), "UTF-8");
                    String v = URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                    map.put(k, v);
                } catch (Exception ignored) {
                }
            }
        }
        return map;
    }

    private static int parseIntSafe(String s, int def) {
        try {
            return s == null ? def : Integer.parseInt(s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private static long parseLongSafe(String s, long def) {
        try {
            return s == null ? def : Long.parseLong(s.trim());
        } catch (Exception e) {
            return def;
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }
}

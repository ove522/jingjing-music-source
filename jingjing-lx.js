/*!
 * @name         鲸鲸音源
 * @description  酷我直连 + 网易云兜底 | 适配 LX Music / SollinPlayer
 * @version      2.1.0
 * @author       大肥鱼
 * @homepage     https://github.com/ove522/jingjing-music-source
 * @lastUpdate   2026-11-02
 * @update       1. 修 request 调用方式为回调式；2. 修 openDevTools 字段名；3. 带 env/version 请求头；4. 音质如实上报
 * @license      仅供学习交流，请支持正版
 */

const { EVENT_NAMES, request, on, send, env, version } = globalThis.lx;

const SCRIPT_NAME = "鲸鲸音源";
const SCRIPT_VERSION = "2.1.0";

const UA = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36";

const KW_SRC = "kwplayerhd_ar_4.3.0.8_tianbao_T1A_qirui.apk";
const KW_HOSTS = [
  "http://nmobi.kuwo.cn/mobi.s",
  "https://mobi.kuwo.cn/mobi.s",
  "http://mobi.kuwo.cn/mobi.s"
];

const KW_BR = {
  "128k": "128kmp3",
  "320k": "320kmp3",
  "flac": "2000kflac"
};

const MUSIC_QUALITIES = {
  kw: ["128k", "320k", "flac"],
  wy: ["128k", "320k", "flac"],
  tx: ["128k", "320k"],
  kg: ["128k", "320k"],
  mg: ["128k", "320k"]
};

const PLATFORM_NAMES = {
  kw: "酷我音乐",
  wy: "网易云音乐",
  tx: "QQ音乐",
  kg: "酷狗音乐",
  mg: "咪咕音乐"
};

function httpGet(url, opts) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error("请求超时"));
    }, (opts && opts.timeout) || 12000);

    request(url, {
      method: "GET",
      headers: (opts && opts.headers) || {},
      timeout: (opts && opts.timeout) || 12000
    }, function (err, resp, body) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(body);
    });
  });
}

async function getJson(url, opts) {
  var text = await httpGet(url, opts);
  if (text == null) throw new Error("空响应");
  if (typeof text !== "string") return text;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("JSON 解析失败: " + text.slice(0, 60));
  }
}

async function kwUrl(rid, quality) {
  var br = KW_BR[quality];
  if (!br) throw new Error("酷我不支持该音质: " + quality);

  var lastErr = null;
  for (var i = 0; i < KW_HOSTS.length; i++) {
    var q = "f=web&user=0&source=" + encodeURIComponent(KW_SRC) +
      "&type=convert_url_with_sign&rid=" + encodeURIComponent(rid) + "&br=" + br;
    try {
      var j = await getJson(KW_HOSTS[i] + "?" + q, { headers: { "User-Agent": UA } });
      if (j && j.code === 200 && j.data && j.data.url) return j.data.url;
      lastErr = new Error((j && j.msg) || "酷我返回空地址");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("酷我全部节点失败");
}

async function wyUrl(id, quality) {
  var br = quality === "flac" ? 999000 : quality === "320k" ? 320000 : 128000;
  var ua = "lx-music-" + (env || "unknown") + "/" + (version || "unknown");
  var j = await getJson(
    "https://music.163.com/api/song/enhance/player/url?id=" + encodeURIComponent(id) +
    "&ids=%5B" + encodeURIComponent(id) + "%5D&br=" + br,
    { headers: { "User-Agent": ua, Referer: "https://music.163.com/", Cookie: "os=pc; appver=8.9.70;" } }
  );
  var d = j && j.data && j.data[0];
  if (d && d.url) return d.url;
  throw new Error("网易云未返回地址");
}

function pickId(info) {
  if (!info) return "";
  return String(info.rid || info.songmid || info.hash || info.id || info.songId || "");
}

async function resolve(source, musicInfo, quality) {
  var id = pickId(musicInfo);
  if (!id) throw new Error("缺少歌曲 ID");

  if (source === "kw") return await kwUrl(id, quality);

  if (source === "wy") {
    try {
      return await wyUrl(id, quality);
    } catch (e) {
      return await kwUrl(id, quality);
    }
  }

  return await kwUrl(id, quality);
}

on(EVENT_NAMES.request, function (data) {
  var action = data.action;
  var source = String(data.source || "").toLowerCase();
  var info = data.info || {};
  var quality = info.type || "320k";

  if (action !== "musicUrl") return Promise.reject(new Error("不支持的操作: " + action));
  if (!MUSIC_QUALITIES[source]) return Promise.reject(new Error("不支持的音乐源: " + source));

  return resolve(source, info.musicInfo || {}, quality)
    .then(function (url) { return url; })
    .catch(function (e) {
      console.error("[" + SCRIPT_NAME + "]", e && e.message);
      return Promise.reject(e);
    });
});

var sources = {};
Object.keys(MUSIC_QUALITIES).forEach(function (p) {
  sources[p] = {
    name: PLATFORM_NAMES[p],
    type: "music",
    actions: ["musicUrl"],
    qualitys: MUSIC_QUALITIES[p]
  };
});

send(EVENT_NAMES.inited, {
  status: true,
  openDevTools: false,
  sources: sources
});

/**
 * @name 鲸鲸音源
 * @description MusicFree 音源插件 | 爱听音乐网(m.6uq.cn) 主源 + 网易云 + 补源(buguyy/wwyy) 多源兜底
 * @version 1.2.5
 * @author 大肥鱼
 * @homepage https://m.6uq.cn
 */

// 环境自带全局 axios（MusicFree 沙箱里没有 require）
var http = (typeof axios !== "undefined" && axios) || (typeof request !== "undefined" && request) || null;
if (!http) throw new Error("沙箱里没有可用的 http 客户端");

const HOST = "https://m.6uq.cn";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  "User-Agent": UA,
  Referer: HOST + "/",
  Accept: "*/*",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

const AJAX_HEADERS = Object.assign({}, BASE_HEADERS, {
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
});

const NE_HEADERS = {
  "User-Agent": UA,
  Referer: "https://music.163.com/",
  Accept: "*/*",
};

const KW_HEADERS = {
  "User-Agent": UA,
  Referer: "https://www.kuwo.cn/",
  Accept: "*/*",
};

/* ---------------- 补源站点（实测可用，同一套 api 模板） ---------------- */

const MIRRORS = [
  { key: "buguyy", name: "buguyy", base: "https://www.buguyy.cc" },
  { key: "wwyy", name: "wwyy", base: "https://www.wwyy.top" },
];

function mirrorHeaders(base) {
  return { "User-Agent": UA, Referer: base + "/", Accept: "*/*" };
}

function b64decodeId(sid) {
  // 站点给的 id 是酷我 rid 的 base64
  try {
    if (typeof atob === "function") return atob(sid);
    if (typeof Buffer !== "undefined") return Buffer.from(sid, "base64").toString("binary");
    return "";
  } catch (e) {
    return "";
  }
}

async function mirrorSearch(mirror, query) {
  const url = mirror.base + "/api/search?keyword=" + encodeURIComponent(query);
  const r = await http.get(url, { headers: mirrorHeaders(mirror.base), timeout: 15000 });
  const j = r.data || {};
  if (!j.success) throw new Error(mirror.name + " success=false");
  const list = j.data || [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    out.push({
      id: "mr_" + mirror.key + "_" + it.id,
      source: "mirror",
      mirror: mirror,
      sid: it.id,
      title: cleanText(it.title || it.name || ""),
      artist: cleanText(it.singer || ""),
      artId: it.picurl || undefined,
    });
  }
  return out;
}

async function mirrorUrl(mirror, sid) {
  const url = mirror.base + "/api/geturl?id=" + encodeURIComponent(sid);
  const r = await http.get(url, { headers: mirrorHeaders(mirror.base), timeout: 15000 });
  const j = r.data || {};
  if (!j.success) throw new Error(mirror.name + " geturl success=false");
  const u = String(j.url || "").trim();
  if (!/^https?:\/\//.test(u)) throw new Error(mirror.name + " 返回空地址");
  return { url: u, rawLrc: String(j.lrc || "") };
}

/* ---------------- 通用工具 ---------------- */

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\u0026/g, "&")
    .replace(/\\&/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTitle(raw) {
  const t = cleanText(raw).replace(/\[(MP3_LRC|MP3|LRC)\]/gi, "").trim();
  const m = t.match(/^(.*?)《(.*)》$/) || t.match(/^(.*?)《(.*?)》/);
  if (m) return { artist: m[1].trim(), name: m[2].trim() };
  return { artist: "", name: t };
}

/* ---------------- 反二改/翻唱 过滤 ---------------- */

const BAD_TITLE = [
  "dj", "remix", "伴奏", "纯音乐", "钢琴版", "吉他版", "萨克斯",
  "翻唱", "cover", "翻自", "原唱:", "原唱：", "女声版", "男声版", "童声版", "童声", "合唱版",
  "3d环绕", "环绕版", "抖音版", "加速版", "慢速版", "降调", "升调",
  "消音", "清唱", "片段", "试听版", "铃声", "串烧", "连播",
  "r&b版", "摇滚版", "古风版", "抒情版", "治愈版", "甜妹版", "深情版", "温柔版",
  "现场版", "演唱会", "八音盒", "口琴", "二胡", "笛子", "古筝", "尤克里里",
  "karaoke", "instrumental", "inst版", "伴奏版", "重制版",
  "说唱版", "喊麦", "鬼畜", "搞笑版", "恶搞", "变声",
  "live", "(live)", "type beat", "typebeat", "beat", "pop rap", "popxtrap",
  "网感", "免费]", "免费", "prod.", "prod", "编曲版", "改编版",
  "现场", "加速", "挑战版", "花絮", "纯钢琴", "钢琴曲", "独唱", "清唱版",
  "网友改编", "改编", "欢快", "律动版", "变音", "堵桥版", "合声",
  "演出", "歌友会", "颁奖", "晚会", "演唱会版", "水果演奏", "cut ",
  "配乐", "bgm", "静音", "无损试听", "demo", "小样", "r&b", "r&b版", "rnb",
];

const BAD_ARTIST = [
  "音乐风格电台", "翻唱", "beat", "beats", "type", "remix", "dj",
];

// 标题里同时出现 + 和两首不同歌名，基本是串烧
// 括号里带"版"的（如：女声独唱版/加速挑战版/欢快律动版）
function isCoverVersion(title) {
  const t = String(title || "");
  return /[（(][^）)]{0,20}版[）)]/.test(t);
}

function isMedley(title) {
  const t = String(title || "");
  if (/[+＋]/.test(t) && /[\u4e00-\u9fa5]{2,}/.test(t)) return true;
  if ((t.match(/[+＋]/g) || []).length >= 1) return true;
  return false;
}

// 歌手栏里有 3 个以上人名（带 & , 、 分隔）当合唱，不要
function isManyArtists(artist) {
  const a = String(artist || "");
  const parts = a.split(/[&,，、\/]/).filter(function (x) { return x.trim(); });
  return parts.length >= 2;
}

function isBadVersion(title, artist) {
  const t = String(title || "").toLowerCase();
  const a = String(artist || "").toLowerCase();
  for (let i = 0; i < BAD_TITLE.length; i++) {
    if (t.indexOf(BAD_TITLE[i]) !== -1) return true;
  }
  for (let i = 0; i < BAD_ARTIST.length; i++) {
    if (a.indexOf(BAD_ARTIST[i]) !== -1) return true;
  }
  if (isCoverVersion(title)) return true;
  if (isMedley(title)) return true;
  if (isManyArtists(artist)) return true;
  return false;
}

function splitQueryArtist(query) {
  const q = cleanText(query);
  const m = q.match(/^(.+?)\s*[-—]\s*(.+)$/);
  if (m) return { name: m[1].trim(), artist: m[2].trim(), words: [m[1].trim(), m[2].trim()] };
  const sp = q.split(/\s+/).filter(Boolean);
  if (sp.length >= 2) return { name: sp[0], artist: "", words: sp };
  return { name: q, artist: "", words: [q] };
}

// 多词查询：歌名或歌手任一对上就算相关（不硬拆谁是谁）
function queryMatch(item, query) {
  const pq = splitQueryArtist(query);
  if (pq.words.length <= 1) return isRelevant(item, query);
  const hay = ((item.title || "") + " " + (item.artist || "")).replace(/\s+/g, "").toLowerCase();
  for (var i = 0; i < pq.words.length; i++) {
    var w = pq.words[i].replace(/\s+/g, "").toLowerCase();
    if (w && hay.indexOf(w) === -1) return false;
  }
  return true;
}

function artistMatches(artist, want) {
  if (!want) return true;
  const a = String(artist || "").replace(/\s+/g, "").toLowerCase();
  const w = String(want).replace(/\s+/g, "").toLowerCase();
  if (!a) return false;
  return a.indexOf(w) !== -1 || w.indexOf(a) !== -1;
}

function isRelevant(item, query) {
  const q = String(query || "").replace(/\s+/g, "").toLowerCase();
  if (!q) return true;
  const hay = ((item.title || "") + (item.artist || "")).replace(/\s+/g, "").toLowerCase();
  if (hay.indexOf(q) !== -1) return true;
  const parts = q.match(/[\u4e00-\u9fa5]{2}/g) || [];
  for (let i = 0; i < parts.length; i++) {
    if (hay.indexOf(parts[i]) !== -1) return true;
  }
  const words = String(query).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  for (let i = 0; i < words.length; i++) {
    if (hay.indexOf(words[i]) !== -1) return true;
  }
  return false;
}

/* ---------------- 爱听音乐网 (6uq) ---------------- */

async function post6uq(id) {
  const resp = await http.post(
    HOST + "/js/play.php",
    "id=" + encodeURIComponent(id) + "&type=music",
    { headers: AJAX_HEADERS, timeout: 15000 }
  );
  const d = resp.data || {};
  if (!d.url) throw new Error("6uq 未返回 url");
  return d;
}

async function search6uq(query, page) {
  const p = Number(page) > 1 ? "/" + Number(page) : "";
  const url = HOST + "/so/" + encodeURIComponent(query) + p + ".html";
  const resp = await http.get(url, { headers: BASE_HEADERS, timeout: 15000 });
  const html = String(resp.data || "");

  const re = /<div class="name"><a href="[^"]*\/play\/([A-Za-z0-9]+)\.html"[^>]*>([\s\S]*?)<\/a><\/div>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const t = parseTitle(m[2]);
    if (!id || !t.name) continue;
    out.push({ id: "6uq_" + id, source: "6uq", rawId: id, title: t.name, artist: t.artist });
  }
  return out;
}

/* ---------------- 网易云 (只取免费歌) ---------------- */

async function searchNetease(query, limit) {
  const n = limit || 30;
  const u =
    "https://music.163.com/api/cloudsearch/pc?s=" +
    encodeURIComponent(query) +
    "&type=1&limit=" +
    n +
    "&offset=0";
  const r = await http.get(u, { headers: NE_HEADERS, timeout: 15000 });
  const j = r.data || {};
  const songs = (j.result && j.result.songs) || [];
  const out = [];
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    out.push({
      id: "ne_" + s.id,
      source: "netease",
      rawId: s.id,
      title: s.name,
      artist: (s.ar || []).map(function (a) { return a.name; }).join(","),
      artId: (s.al && s.al.pic) || undefined,
      free: s.fee === 0 && ((s.privilege && s.privilege.pl) || 0) > 0,
    });
  }
  return out;
}

async function neteaseUrl(id, br) {
  const b = br || 320000;
  const u =
    "https://music.163.com/api/song/enhance/player/url?ids=[" +
    Number(id) +
    "]&br=" +
    b;
  const r = await http.get(u, { headers: NE_HEADERS, timeout: 15000 });
  const d = (r.data && r.data.data && r.data.data[0]) || null;
  if (d && d.code === 200 && d.url) return { url: d.url, br: d.br, size: d.size };
  return null;
}

/* ---------------- 酷我 ---------------- */

async function kuwoUrl(rid) {
  const u =
    "http://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_" +
    rid;
  const r = await http.get(u, { headers: KW_HEADERS, timeout: 15000, responseType: "text" });
  const t = String(r.data || "").trim();
  return /^https?:\/\//.test(t) ? t : null;
}

/* ---------------- 多源兜底链 ---------------- */

async function resolveChain(item, quality, keyword) {
  const chain = [];
  const brMap = { low: 128000, standard: 192000, high: 320000, super: 999000 };
  const br = brMap[quality] || 320000;

  // 1. 自己本来那个源优先
  if (item.source === "netease") {
    chain.push(function () { return neteaseUrl(item.rawId, br); });
    chain.push(function () { return neteaseUrl(item.rawId, 128000); });
  } else if (item.source === "6uq") {
    chain.push(function () { return post6uq(item.rawId); });
  } else if (item.source === "mirror") {
    chain.push(function () { return mirrorUrl(item.mirror, item.sid); });
  }

  // 2. 有酷我 rid 就直接拿
  if (item.rid) {
    chain.push(function () {
      return kuwoUrl(item.rid).then(function (u) { return u ? { url: u } : null; });
    });
  }

  // 3. 主源挂了，用关键词到补源上再搜一遍（这是这次加的重点）
  if (keyword) {
    for (let i = 0; i < MIRRORS.length; i++) {
      (function (m) {
        chain.push(async function () {
          const list = await mirrorSearch(m, keyword);
          if (!list.length) throw new Error(m.name + " 无结果");
          // 按名称相似度排一下，wwyy 的排序很烂，不能直接用第一条
          const q = String(keyword).replace(/\s+/g, "").toLowerCase();
          list.sort(function (a, b) {
            const sa = (a.title + a.artist).replace(/\s+/g, "").toLowerCase();
            const sb = (b.title + b.artist).replace(/\s+/g, "").toLowerCase();
            const ra = sa.indexOf(q) !== -1 ? 0 : 1;
            const rb = sb.indexOf(q) !== -1 ? 0 : 1;
            if (ra !== rb) return ra - rb;
            return a.title.length - b.title.length;
          });
          let lastErr = null;
          for (let k = 0; k < list.length && k < 5; k++) {
            try {
              const r = await mirrorUrl(m, list[k].sid);
              if (r && r.url) return r;
            } catch (e) {
              lastErr = e;
            }
          }
          throw lastErr || new Error(m.name + " 全部取链失败");
        });
      })(MIRRORS[i]);
    }
  }

  const tried = [];
  for (let i = 0; i < chain.length; i++) {
    try {
      const r = await chain[i]();
      if (r && r.url) return r;
      tried.push("empty" + i);
    } catch (e) {
      tried.push("err" + i + ":" + (e && e.message ? String(e.message).slice(0, 40) : "unknown"));
    }
  }
  const err = new Error("所有源都没拿到播放地址 (" + tried.join(" | ") + ")");
  err.tried = tried;
  throw err;
}

/* ---------------- 搜索结果排序 ---------------- */

function scoreItem(it, query) {
  const pq = splitQueryArtist(query);
  const title = String(it.title || "").replace(/\s+/g, "").toLowerCase();
  const artist = String(it.artist || "").replace(/\s+/g, "").toLowerCase();
  const want = pq.name.replace(/\s+/g, "").toLowerCase();
  let s = 0;
  if (title === want) s += 100;
  else if (title.indexOf(want) === 0) s += 60;
  else if (title.indexOf(want) !== -1) s += 20;
  if (pq.artist && artistMatches(artist, pq.artist)) s += 80;
  // 标题里夹着歌手的名字（比如"七里香周杰伦"），但歌手栏不是他，扣分
  if (query.indexOf("周杰伦") !== -1 && artist.indexOf("周杰伦") === -1) s -= 50;
  if (artist.length > 12) s -= 10;
  if (it.source === "6uq") s += 5;
  if (it.source === "netease") s += 3;
  return s;
}

const memo = {};
const idKeyword = {}; // id -> 关键词，getMediaSource 时补源要用

module.exports = {
  platform: "鲸鲸音源",
  version: "1.2.5",
  author: "大肥鱼",
  srcUrl: HOST,
  cacheControl: "no-store",
  primaryKey: ["id"],
  supportedSearchType: ["music"],

  async search(query, page, type) {
    const pg = Number(page) || 1;
    const tasks = [
      search6uq(query, pg).catch(function () { return []; }),
      pg === 1 ? searchNetease(query, 30).catch(function () { return []; }) : Promise.resolve([]),
    ];
    // 补源也跟着一起搜，6uq 没收录的歌也能搜到
    if (pg === 1) {
      for (let i = 0; i < MIRRORS.length; i++) {
        tasks.push(mirrorSearch(MIRRORS[i], query).catch(function () { return []; }));
      }
    }
    const res = await Promise.all(tasks);
    let merged = [];
    for (let i = 0; i < res.length; i++) merged = merged.concat(res[i] || []);

    const seen = {};
    const data = [];
    for (let i = 0; i < merged.length; i++) {
      const it = merged[i];
      if (!queryMatch(it, query)) continue;
      if (isBadVersion(it.title, it.artist)) continue;
      const key = (it.title + "|" + it.artist).toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      if (it.source === "netease" && !it.free) continue;
      idKeyword[it.id] = query;
      const row = {
        id: it.id,
        title: it.title,
        artist: it.artist,
        albumArt: it.artId,
      };
      data.push(row);
    }
    data.sort(function (a, b) { return scoreItem(b, query) - scoreItem(a, query); });
    return { isEnd: merged.length === 0, data: data };
  },

  async getMediaSource(musicItem, quality) {
    const rawId0 = String((musicItem && musicItem.id) || "");
    const cache = memo[rawId0];
    if (cache) return cache;

    let item = null;
    let keyword = idKeyword[rawId0] || "";

    if (rawId0.indexOf("ne_") === 0) {
      item = { source: "netease", rawId: rawId0.slice(3) };
    } else if (rawId0.indexOf("6uq_") === 0) {
      item = { source: "6uq", rawId: rawId0.slice(4) };
    } else if (rawId0.indexOf("mr_") === 0) {
      const rest = rawId0.slice(3);
      const pos = rest.indexOf("_");
      const mkey = pos > 0 ? rest.slice(0, pos) : "";
      const sid = pos > 0 ? rest.slice(pos + 1) : "";
      let mirror = null;
      for (let i = 0; i < MIRRORS.length; i++) {
        if (MIRRORS[i].key === mkey) mirror = MIRRORS[i];
      }
      if (!mirror) throw new Error("未知补源: " + mkey);
      item = { source: "mirror", mirror: mirror, sid: sid };
    } else {
      // 裸 id 当 6uq 处理，兼容老数据
      item = { source: "6uq", rawId: rawId0 };
    }

    // 没记到关键词就用歌名去兜底
    if (!keyword && musicItem && musicItem.title) keyword = musicItem.title;

    console.log(
      "[鲸鲸音源] getMediaSource id=" + rawId0 + " src=" + item.source + " kw=" + keyword
    );

    const r = await resolveChain(item, quality, keyword);
    if (!r || !r.url) throw new Error("未取到播放地址");
    const res = { url: r.url };
    if (r.rawLrc) memo["lrc_" + rawId0] = r.rawLrc;
    memo[rawId0] = res;
    return res;
  },

  async getCover(musicItem) {
    const id = String(musicItem.id || "");
    try {
      if (musicItem.artwork) return musicItem.artwork;
      if (musicItem.albumArt) return musicItem.albumArt;
      if (id.indexOf("6uq_") === 0) {
        const d = await post6uq(id.slice(4));
        return d.pic || undefined;
      }
      return undefined;
    } catch (e) {
      return undefined;
    }
  },

  async getLyric(musicItem) {
    const id = String(musicItem.id || "");
    try {
      const cached = memo["lrc_" + id];
      if (cached) return { rawLrc: cached };

      if (id.indexOf("6uq_") === 0) {
        const resp = await http.get(
          HOST + "/plug/lrcgc.php?id=" + encodeURIComponent(id.slice(4)),
          { headers: AJAX_HEADERS, timeout: 10000 }
        );
        let lrc = (resp.data && resp.data.lrc) || "";
        lrc = String(lrc).replace(/\\n/g, "\n").replace(/\\r/g, "");
        return { rawLrc: lrc };
      }
      if (id.indexOf("ne_") === 0) {
        const resp = await http.get(
          "https://music.163.com/api/song/lyric?os=pc&id=" + id.slice(3) + "&lv=-1&kv=-1&tv=-1",
          { headers: NE_HEADERS, timeout: 10000 }
        );
        const d = resp.data || {};
        return { rawLrc: (d.lrc && d.lrc.lyric) || "" };
      }
      if (id.indexOf("mr_") === 0) {
        // 补源的歌词在 geturl 里一起返回，这里再取一次
        const rest = id.slice(3);
        const pos = rest.indexOf("_");
        const mkey = pos > 0 ? rest.slice(0, pos) : "";
        const sid = pos > 0 ? rest.slice(pos + 1) : "";
        let mirror = null;
        for (let i = 0; i < MIRRORS.length; i++) {
          if (MIRRORS[i].key === mkey) mirror = MIRRORS[i];
        }
        if (!mirror) return { rawLrc: "" };
        const r = await mirrorUrl(mirror, sid);
        return { rawLrc: r.rawLrc || "" };
      }
      return { rawLrc: "" };
    } catch (e) {
      return { rawLrc: "" };
    }
  },
};

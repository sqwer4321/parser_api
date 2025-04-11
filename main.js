const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// Constants
const USER_AGENT = "Mozilla/5.0";
const API_URL = "https://shikimori.one/api/graphql";
const TEMP_FILE = "anilibria_temp_data.json";
const DB_API_URL = "https://домен_апи/db/anime";
const KODIK_TOKEN = "токен";

// GraphQL Query
const GRAPHQL_QUERY_IDS = `
query ($ids: String!) {
  animes(ids: $ids) {
    id
    malId
    name
    russian
    licenseNameRu
    english
    japanese
    synonyms
    kind
    rating
    score
    status
    episodes
    episodesAired
    duration
    airedOn { year month day date }
    releasedOn { year month day date }
    url
    season
    poster { id originalUrl mainUrl }
    fansubbers
    fandubbers
    licensors
    createdAt
    updatedAt
    nextEpisodeAt
    isCensored
    genres { id name russian kind }
    studios { id name imageUrl }
    externalLinks {
      id
      kind
      url
      createdAt
      updatedAt
    }
    personRoles {
      id
      rolesRu
      rolesEn
      person { id name poster { id } }
    }
    characterRoles {
      id
      rolesRu
      rolesEn
      character { id name poster { id } }
    }
    related {
      id
      anime {
        id
        name
      }
      manga {
        id
        name
      }
      relationKind
      relationText
    }
    videos { id url name kind playerUrl imageUrl }
    screenshots { id originalUrl x166Url x332Url }
    scoresStats { score count }
    statusesStats { status count }
    description
    descriptionHtml
    descriptionSource
  }
}
`;

class AnimeCollector {
  constructor() {
    this.allAnimes = [];
    this.loadTempData();
  }

  loadTempData() {
    try {
      if (fs.existsSync(TEMP_FILE)) {
        const data = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));
        this.allAnimes = data.all_animes || [];
        console.log(`Загружено ${this.allAnimes.length} временно сохраненных аниме`);
      }
    } catch (e) {
      console.log(`Ошибка при загрузке временных данных: ${e}`);
    }
  }

  saveTempData() {
    try {
      const data = {
        all_animes: this.allAnimes,
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(TEMP_FILE, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Временные данные сохранены (всего ${this.allAnimes.length} аниме)`);
    } catch (e) {
      console.log(`Ошибка при сохранении временных данных: ${e}`);
    }
  }

  cleanup() {
    try {
      if (fs.existsSync(TEMP_FILE)) {
        fs.unlinkSync(TEMP_FILE);
        console.log("Временный файл удален");
      }
    } catch (e) {
      console.log(`Ошибка при удалении временного файла: ${e}`);
    }
  }

  async getAnimeById(animeId) {
    const headers = {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    const payload = {
      query: GRAPHQL_QUERY_IDS,
      variables: { ids: String(animeId) }
    };

    try {
      const response = await axios.post(API_URL, payload, { headers, timeout: 30000 });
      const data = response.data;

      if (data.errors) {
        console.log(`Ошибка при получении аниме с ID ${animeId}: ${JSON.stringify(data.errors)}`);
        return null;
      }

      const animes = data.data?.animes || [];
      return animes[0] || null;
    } catch (e) {
      console.log(`Ошибка запроса для аниме с ID ${animeId}: ${e}`);
      return null;
    }
  }

  async getAnimesByIdsRange(startId, endId) {
    for (let animeId = startId; animeId <= endId; animeId++) {
      console.log(`Запрашиваем аниме с ID ${animeId}...`);
      const anime = await this.getAnimeById(animeId);
      if (anime) {
        this.allAnimes.push(anime);
        console.log(`Получено аниме с ID ${animeId}`);
        this.saveTempData();
      }
    }
    return this.allAnimes;
  }
}

function filterAnilibriaAnimes(animes) {
  return animes.filter(anime => {
    const fandubbers = anime.fandubbers || [];
    const hasAnilibria = fandubbers.some(fandubber => 
      new RegExp("\\bAniLibria\\b", "i").test(fandubber)
    );
    
    if (hasAnilibria) {
      console.log(`Добавлено аниме ID ${anime.id} с фандаббером AniLibria`);
    } else {
      console.log(`Пропущено аниме ID ${anime.id} — AniLibria не найдено в фандабберах`);
    }
    
    return hasAnilibria;
  });
}

async function getKodikData(shikimoriId) {
  const url = `https://kodikapi.com/search?token=${KODIK_TOKEN}&shikimori_id=${shikimoriId}&with_episodes=true&with_material_data=true`;
  
  try {
    const response = await axios.get(url);
    if (response.data.total > 0) {
      return response.data.results[0];
    }
    return null;
  } catch (e) {
    console.log(`Ошибка при получении данных Kodik для ID ${shikimoriId}: ${e}`);
    return null;
  }
}

function translateStatus(status) {
  switch (status) {
    case "released": return "Вышел";
    case "ongoing": return "Онгоинг";
    case "tba": return "Неизвестно";
    default: return status;
  }
}

function translateType(type) {
  switch (type) {
    case "tv": return "TV Сериал";
    case "ova": return "OVA";
    case "movie": return "Фильм";
    case "special": return "Специальный выпуск";
    default: return type;
  }
}

async function getRelatedAnimes(anime, collector) {
  const relatedIds = [...new Set(
    anime.related
      ?.filter(rel => rel.anime?.id)
      .map(rel => String(rel.anime.id)) || []
  )];

  const relatedDataList = [];
  
  for (const rid of relatedIds) {
    const relatedData = await collector.getAnimeById(rid);
    if (relatedData) {
      relatedDataList.push({
        id: relatedData.id,
        title: relatedData.russian || relatedData.name,
        poster: relatedData.poster?.originalUrl
      });
    }
  }
  
  return relatedDataList;
}

function fixUrl(url) {
  if (!url) return url;
  return url
    .replace('https://shikimori.onehttps://shikimori.one', 'https://shikimori.one')
    .replace('//kodik.info//kodik.info', '//kodik.info');
}

async function prepareAnimeData(anime, kodikData = null, collector) {
  const formatJsonArray = (items, key = 'name') => 
    items?.map(item => ({ [key]: item })) || [];

  const posterUrl = `https://s3.ru1.storage.beget.cloud/имя бакета/anime/${anime.id}/poster.jpeg`;

  const animeData = {
    id: anime.id,
    licensenameru: !!anime.licenseNameRu,
    name: anime.name || "",
    russian: anime.russian || "",
    japanese: anime.japanese || "",
    quality: "HD",
    poster: posterUrl,
    kind: translateType(anime.kind || ""),
    score: anime.score ? parseFloat(anime.score).toFixed(1) : null,
    status: translateStatus(anime.status || ""),
    episodes: anime.episodes,
    duration: anime.duration,
    season: anime.season,
    released: anime.airedOn?.date || "",
    minimal_age: "16",
    countries: "Япония",
    description: anime.description || "Нет описания",
    actors: [],
    studios: [],
    directors: [],
    genres: [],
    externallinks: [],
    screenshots: [
      { url: `https://s3.ru1.storage.beget.cloud/имя бакета/anime/${anime.id}/screenshot1.jpg` },
      { url: `https://s3.ru1.storage.beget.cloud/имя бакета/anime/${anime.id}/screenshot2.jpg` },
      { url: `https://s3.ru1.storage.beget.cloud/имя бакета/anime/${anime.id}/screenshot3.jpg` },
      { url: `https://s3.ru1.storage.beget.cloud/имя бакета/anime/${anime.id}/screenshot4.jpg` }
    ],
    opening: [],
    trailer: [],
    associated: [],
    list: [],
    alternative_player: "",
    fandubbers: (anime.fandubbers || []).join(", ")
  };

  // External links (Kinopoisk)
  animeData.externallinks = (anime.externalLinks || [])
    .filter(link => link.kind === "kinopoisk")
    .map(link => ({ site: "kinopoisk", url: link.url }));

  // Related anime
  const related = await getRelatedAnimes(anime, collector);
  animeData.associated = related.map(r => ({
    id: String(r.id),
    title: r.title,
    poster: fixUrl(r.poster ? `https://shikimori.one${r.poster}` : "")
  }));

  // Kodik data
  if (kodikData) {
    const kodikLink = fixUrl(`//kodik.info${kodikData.link || ""}`);
    const material = kodikData.material_data || {};
    
    Object.assign(animeData, {
      alternative_player: kodikLink,
      minimal_age: String(material.minimal_age || "16"),
      countries: (material.countries || ["Япония"]).join(", "),
      description: material.description || "Нет описания",
      genres: formatJsonArray(material.anime_genres),
      studios: formatJsonArray(material.anime_studios),
      actors: formatJsonArray(material.actors),
      directors: formatJsonArray(material.directors),
      season: String(kodikData.last_season || "1")
    });
  }

  return animeData;
}

async function addToDb(animeData) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  
  try {
    const response = await axios.post(DB_API_URL, animeData, { headers, timeout: 30000 });
    console.log(`Аниме ID ${animeData.id} успешно добавлено в БД`);
    return true;
  } catch (e) {
    console.log(`Ошибка при добавлении аниме ID ${animeData.id} в БД: ${e}`);
    if (e.response) {
      console.log(`Ответ сервера: ${JSON.stringify(e.response.data)}`);
    }
    return false;
  }
}

// Express routes
app.get('/collect', async (req, res) => {
  const collector = new AnimeCollector();
  
  try {
    const startId = parseInt(req.query.start) || 6001;
    const endId = parseInt(req.query.end) || 7000;

    console.log(`Запрашиваем аниме с ID от ${startId} до ${endId}...`);
    const allAnimes = await collector.getAnimesByIdsRange(startId, endId);

    if (allAnimes.length) {
      console.log(`Получено всего ${allAnimes.length} аниме`);
      const anilibriaAnimes = filterAnilibriaAnimes(allAnimes);
      console.log(`Найдено ${anilibriaAnimes.length} аниме с AniLibria`);

      for (const anime of anilibriaAnimes) {
        const kodikData = await getKodikData(anime.id);
        const animeData = await prepareAnimeData(anime, kodikData, collector);
        await addToDb(animeData);
      }

      collector.cleanup();
      res.json({ success: true, message: `Обработано ${anilibriaAnimes.length} аниме` });
    } else {
      res.status(500).json({ success: false, message: "Не удалось получить данные" });
    }
  } catch (e) {
    console.log(`Ошибка: ${e}`);
    collector.saveTempData();
    res.status(500).json({ success: false, message: e.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log("\nПрерывание! Завершение работы...");
  process.exit(0);
});
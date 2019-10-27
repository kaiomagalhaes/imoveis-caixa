const cheerio = require("cheerio");
const express = require("express");
const https = require("https");
const path = require("path");
const redis = require("redis");
const { WebClient } = require("@slack/web-api");

require("dotenv").config();

const PORT = process.env.PORT || 5000;
const SLACK_API_KEY = process.env.SLACK_API_KEY;
const SLACK_TEAM_ID = process.env.SLACK_CHANNEL_ID;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const FETCH_MISSING_INFO =
  `${process.env.FETCH_MISSING_INFO}`.toLowerCase() == "true";
const PROGRESS_LOG_INTERVAL_IN_SECONDS = parseInt(
  process.env.PROGRESS_LOG_INTERVAL_IN_SECONDS || 3
);
const CITIES = process.env.CITIES.trim().split(",");
const NEIGHBORHOODS = process.env.NEIGHBORHOODS.trim().split(",");
const REMOVE_IGNORED_PROPERTIES =
  `${process.env.REMOVE_IGNORED_PROPERTIES}`.toLowerCase() == "true";

const REDIS_URL = process.env.REDIS_URL;
const REDIS_IGNORED_PROPERTIES_KEY = "IGNORED_PROPERTIES";

if (
  !SLACK_API_KEY ||
  !SLACK_CHANNEL_ID ||
  !SLACK_CHANNEL_ID ||
  !CITIES ||
  !NEIGHBORHOODS
) {
  throw new Error(
    "Please set SLACK_API_KEY, SLACK_TEAM_ID, SLACK_CHANNEL_ID, CITIES AND NEIGHBORHOODS!"
  );
}

const PROPERTIES_URL =
  "https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_GO.htm?191651097";

const slackClient = new WebClient(SLACK_API_KEY);
const redisClient = redis.createClient({
  url: REDIS_URL
});

const getIgnoredProperties = async () =>
  new Promise(resolve => {
    redisClient.smembers(REDIS_IGNORED_PROPERTIES_KEY, (err, members) =>
      resolve(members)
    );
  });

const parseTextCell = ($, tr, index) =>
  $(
    $(tr)
      .find("td")
      .get(index)
  )
    .text()
    .trim()
    .toString("utf8");

const parseURLCell = ($, tr, index) =>
  $(
    $(tr)
      .find("td")
      .get(index)
  )
    .find("a")
    .attr("href");

const postPropertyToSlack = async (property, threadId) => {
  const text = `\`\`\`${property.description}\`\`\`

  
*Endereço*: ${property.address} 
*Bairro*: ${property.neighborhood}
*Valor Original*: R$ ${property.valuation}
*Valor Atual*: R$ ${property.amount} (${property.discount}% abaixo do valor original)
*Situação*: ${property.saleType}


<${property.url}>
  `;
  console.log("Sending property to slack", text);

  const result = await slackClient.chat.postMessage({
    text,
    team: SLACK_TEAM_ID,
    channel: SLACK_CHANNEL_ID,
    icon_emoji: ":house_with_garden:",
    username: "Buscador de Imóveis",
    thread_ts: threadId
  });

  // The result contains an identifier for the message, `ts`.
  console.log(
    `Successfully sent message ${result.ts} in conversation ${SLACK_CHANNEL_ID}`
  );
};

const postPropertiesToSlack = async properties => {
  const text =
    properties.length > 0
      ? `
  ${":chandler_dance:".repeat(properties.length)}
  Temos ${properties.length} ${properties.length == 1 ? "imóvel" : "imóveis"} ${
          properties.length == 1 ? "disponível" : "disponíveis"
        }!!
  ${":chandler_dance:".repeat(properties.length)}
  ------------------
  Localizações disponíveis: ${[
    ...new Set(properties.map(({ neighborhood }) => neighborhood))
  ].join(", ")}
  ------------------
  `
      : "Nenhum imóvel hoje. Sorry :sad_face:";

  const result = await slackClient.chat.postMessage({
    text,
    team: SLACK_TEAM_ID,
    channel: SLACK_CHANNEL_ID,
    icon_emoji: ":house_with_garden:",
    username: "Buscador de Imóveis"
  });

  // The result contains an identifier for the message, `ts`.
  console.log(
    `Successfully sent message ${result.ts} in conversation ${SLACK_CHANNEL_ID}`
  );

  await properties.forEach(property => {
    postPropertyToSlack(property, result.ts);
  });
};

const fetchProperties = async () => {
  console.log(`Fetching properties from ${PROPERTIES_URL}`);

  let ignoredProperties = [];
  try {
    ignoredProperties = await getIgnoredProperties();
  } catch (ex) {
    console.error("Error fetching", ex);
    ignoredProperties = [];
  }

  if (REMOVE_IGNORED_PROPERTIES) {
    console.log(`Ignored properties`, ignoredProperties);
  }

  return https.get(
    PROPERTIES_URL,

    response => {
      response.setEncoding("binary");
      let body = "";
      let dateCreated = new Date();
      let lastUpdated = dateCreated;

      response.on("data", data => {
        const timeSinceLastUpdate = new Date() - lastUpdated;
        if (timeSinceLastUpdate > PROGRESS_LOG_INTERVAL_IN_SECONDS * 1000) {
          lastUpdated = new Date();
          console.info(
            "OH jeez! %dms seconds since we started!!!",
            (lastUpdated - dateCreated) / 1000
          );
        }
        body += data;
      });

      response.on("end", () => {
        let $ = cheerio.load(body, { decodeEntities: true });
        body = null;

        const allProperties = $("tr");
        console.log(`Filtering ${allProperties.length} properties`);

        const properties = allProperties
          .map(function(i, el) {
            return {
              url: parseURLCell($, this, 0),
              address: parseTextCell($, this, 1),
              neighborhood: parseTextCell($, this, 2),
              description: parseTextCell($, this, 3),
              amount: parseTextCell($, this, 4),
              valuation: parseTextCell($, this, 5),
              discount: parseTextCell($, this, 6),
              saleType: parseTextCell($, this, 7),
              city: parseTextCell($, this, 9),
              state: parseTextCell($, this, 10)
            };
          })
          .get()
          .filter(function({ address, amount, city, neighborhood, saleType }) {
            const id = `${address}|${amount}|${saleType}`;
            const isIgnored = REMOVE_IGNORED_PROPERTIES
              ? ignoredProperties.includes(id)
              : false;

            if (isIgnored) {
              console.log("IGNORED PROPERTIES", ignoredProperties, id);
            }

            const matchesCity = CITIES.some(c => c === city);
            const matchesAddress =
              (FETCH_MISSING_INFO && !neighborhood) ||
              NEIGHBORHOODS.some(n => n === neighborhood);

            return matchesCity && matchesAddress && !isIgnored;
          });

        $ = null;

        console.log(`Found ${properties.length} properties`);
        postPropertiesToSlack(properties);
      });
    }
  );
};

express()
  .use(express.json())
  .get("/", (req, res) => {
    return res.send("ok");
  })
  //TODO: change to post
  .post("/properties", async (req, res) => {
    console.log(`Started process to fetch properties!`);

    setTimeout(fetchProperties, 0);
    return res.json({
      message: "Process started",
      data: {}
    });
  })
  .delete("/properties", async (req, res) => {
    const { id } = req.body;

    if (id) {
      console.log("Ignoring property", id);

      redisClient.sadd(REDIS_IGNORED_PROPERTIES_KEY, id);
    }

    res.send("ok");
  })
  .delete("/clear", async (req, res) => {
    redisClient.del(REDIS_IGNORED_PROPERTIES_KEY);
    res.send("ok");
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

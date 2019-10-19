const express = require("express");
const path = require("path");
const https = require("https");
const cheerio = require("cheerio");
const cache = require("memory-cache");

const PORT = process.env.PORT || 5000;

const PROPERTIES_URL =
  "https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_GO.htm?191651097";

const CITIES = ["GOIANIA"];
const NEIGHBORHOODS = [
  "ALTO DA GLORIA",
  "JARDIM GOIAS",
  "SETOR BUENO",
  "SETOR MARISTA"
];

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

// configure cache middleware
let memCache = new cache.Cache();
let cacheMiddleware = duration => {
  return (req, res, next) => {
    let key = "__express__" + req.originalUrl || req.url;
    let cacheContent = memCache.get(key);
    if (cacheContent) {
      console.log(`Serving cached content for key: ${key}`);
      res.send(cacheContent);
      return;
    } else {
      console.log(`Purging cache!`);
      memCache.clear();
      res.sendResponse = res.send;
      res.send = body => {
        console.log(`Caching content for key: ${key}`);
        memCache.put(key, body, duration * 1000);
        res.sendResponse(body);
      };
      next();
    }
  };
};

express()
  .get("/", (req, res) => {
    return res.send("ok");
  })
  .get("/properties", cacheMiddleware(1440), (req, res) => {
    console.log(`Fetching properties from ${PROPERTIES_URL}`);

    https.get(
      PROPERTIES_URL,

      response => {
        response.setEncoding("binary");
        let body = "";

        response.on("data", data => {
          body += data;
        });

        response.on("end", () => {
          let $ = cheerio.load(body, { decodeEntities: true });
          body = null;

          const allProperties = $("tr");
          console.log(`Filtering ${allProperties.length} properties`);

          const properties = allProperties
            .map(function(i, el) {
              const url = parseURLCell($, this, 0);
              const address = parseTextCell($, this, 1);
              const neighborhood = parseTextCell($, this, 2);
              const description = parseTextCell($, this, 3);
              const amount = parseTextCell($, this, 4);
              const valuation = parseTextCell($, this, 5);
              const discount = parseTextCell($, this, 6);
              const saleType = parseTextCell($, this, 7);
              const city = parseTextCell($, this, 9);
              const state = parseTextCell($, this, 10);

              return {
                url,
                address,
                neighborhood,
                description,
                amount,
                valuation,
                discount,
                saleType,
                city,
                state
              };
            })
            .get()
            .filter(function({ city, neighborhood }) {
              return (
                CITIES.some(c => c === city) &&
                (!neighborhood || NEIGHBORHOODS.some(n => n === neighborhood))
              );
            });

          $ = null;
          console.log(`Found ${properties.length} properties`);

          return res.json({
            total: properties.length,
            data: properties
          });
        });
      }
    );
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

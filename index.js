const express = require("express");
const path = require("path");
const https = require("https");
const cheerio = require("cheerio");

const PORT = process.env.PORT || 5000;

const AVAILABILITIES_URL =
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

express()
  .get("/", (req, res) => {
    console.log(`Fetching availabilities from ${AVAILABILITIES_URL}`);

    https.get(
      AVAILABILITIES_URL,

      response => {
        response.setEncoding("binary");
        let body = "";

        response.on("data", data => {
          body += data;
        });

        response.on("end", () => {
          console.log(body);

          const $ = cheerio.load(body, { decodeEntities: true });
          const allAvailabilities = $("tr");
          console.log(`Filtering ${allAvailabilities.length} availabilities`);

          debugger;
          const availabilities = allAvailabilities
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

          console.log(
            "\n\n\n\n\n===================================================="
          );
          console.log(`Found ${availabilities.length} availabilities`);
          console.log(availabilities);
          console.log(
            "\n\n\n\n\n===================================================="
          );

          return res.json({
            total: availabilities.length,
            data: availabilities
          });
        });
      }
    );
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`));

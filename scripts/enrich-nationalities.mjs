import fs from "node:fs/promises";
import process from "node:process";

const PEOPLE_PATH = process.argv.find((argument) => argument.startsWith("--people="))?.split("=")[1] || "data/people.json";
const BATCH_SIZE = 200;

const people = JSON.parse(await fs.readFile(PEOPLE_PATH, "utf8"));
const nationalityByImdbId = new Map();

for (let index = 0; index < people.length; index += BATCH_SIZE) {
  const batch = people.slice(index, index + BATCH_SIZE);
  const values = batch.map((person) => `"${person.sourceId}"`).join(" ");
  const query = `
    SELECT DISTINCT ?imdb ?countryLabel WHERE {
      VALUES ?imdb { ${values} }
      ?person wdt:P345 ?imdb .
      ?person wdt:P27 ?country .
      ?country rdfs:label ?countryLabel .
      FILTER(LANG(?countryLabel) = "en")
    }
  `;
  const payload = await sparqlRequest(query);
  for (const row of payload.results?.bindings || []) {
    const imdbId = row.imdb?.value;
    const nationality = toNationality(row.countryLabel?.value);
    if (!imdbId || !nationality) continue;
    if (!nationalityByImdbId.has(imdbId)) nationalityByImdbId.set(imdbId, []);
    nationalityByImdbId.get(imdbId).push(nationality);
  }
  console.log(`Resolved structured nationalities: ${Math.min(index + BATCH_SIZE, people.length)}/${people.length}`);
}

let enriched = 0;
const output = people.map((person) => {
  const nationalities = [...new Set(nationalityByImdbId.get(person.sourceId) || [])].slice(0, 2);
  if (nationalities.length === 0) return person;
  enriched += 1;
  return { ...person, nationality: nationalities.join(" / ") };
});

await fs.writeFile(PEOPLE_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ people: output.length, enriched, unresolved: output.length - enriched }, null, 2));

async function sparqlRequest(query) {
  const response = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      accept: "application/sparql-results+json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Deviate/1.0 dataset-build (https://github.com/harrydbarnes/Deviate)",
    },
    body: new URLSearchParams({ query, format: "json" }),
  });
  if (!response.ok) throw new Error(`Wikidata SPARQL request failed: HTTP ${response.status}`);
  return response.json();
}

function toNationality(label) {
  const names = {
    "United States of America": "American",
    "United States": "American",
    "United Kingdom": "British",
    Canada: "Canadian",
    Australia: "Australian",
    France: "French",
    Italy: "Italian",
    Germany: "German",
    Spain: "Spanish",
    Ireland: "Irish",
    Sweden: "Swedish",
    "Kingdom of Denmark": "Danish",
    Denmark: "Danish",
    "Kingdom of the Netherlands": "Dutch",
    Netherlands: "Dutch",
    Belgium: "Belgian",
    Austria: "Austrian",
    Greece: "Greek",
    Brazil: "Brazilian",
    Romania: "Romanian",
    Mexico: "Mexican",
    Poland: "Polish",
    Hungary: "Hungarian",
    Israel: "Israeli",
    India: "Indian",
    Japan: "Japanese",
    "South Korea": "South Korean",
    "Republic of Korea": "South Korean",
    "Czech Republic": "Czech",
    Czechia: "Czech",
    "Russian Federation": "Russian",
    Russia: "Russian",
    "People's Republic of China": "Chinese",
    China: "Chinese",
    "Hong Kong": "Hong Kong Chinese",
    Taiwan: "Taiwanese",
    Philippines: "Filipino",
    "New Zealand": "New Zealander",
    "South Africa": "South African",
    "United Arab Emirates": "Emirati",
  };
  return names[label] || label;
}

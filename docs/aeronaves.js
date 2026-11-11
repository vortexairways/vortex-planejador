// Catálogo do Mercado de Aeronaves do PilOps (lido em 04/11/2026: 135 modelos).
// Nome | grupo no PilOps | passageiros | alcance (nm) | cruzeiro (kt TAS)
// Nome, grupo e passageiros vêm do PilOps. O PilOps não publica alcance: alcance e cruzeiro são
// valores de catálogo dos fabricantes com carga típica e reservas, arredondados para baixo. Servem para
// triagem de rotas; combustível, carga e vento continuam sendo decididos no PilOps/MSFS.
const aircraftCatalog = `Piper J-3C Cub|Hélices|1|190|65
Beechcraft Bonanza V35|Hélices|5|750|165
Piper PA-24 Comanche|Hélices|4|800|160
Kitfox Series 5|Hélices|1|400|100
Beechcraft B60 Duke|Hélices|5|1000|220
Cessna 152|Hélices|1|410|105
PA-24-250 Comanche|Hélices|4|800|160
Cessna 170B|Hélices|3|500|105
Beechcraft Baron B55|Hélices|6|950|190
Cessna 172 Skyhawk|Hélices|3|640|120
A2A Aerostar 600|Hélices|5|1000|220
Beechcraft D17 Staggerwing|Hélices|4|650|175
Beechcraft B58 Baron|Hélices|5|1300|200
Cessna 182|Hélices|3|900|140
Wilga (PZL-104)|Hélices|3|350|100
Piper PA-28 Arrow III|Hélices|3|800|135
Tecnam P2010|Hélices|3|650|130
Cessna A185F Skywagon|Hélices|5|700|140
Rockwell Commander 114|Hélices|3|800|155
De Havilland DHC-2 Beaver|Hélices|6|390|120
Beechcraft C24R Sierra|Hélices|3|600|140
Diamond DA40NG|Hélices|3|750|140
Beechcraft Bonanza F33A|Hélices|3|800|170
GippsAero GA8 Airvan|Hélices|7|650|125
Beechcraft Bonanza A36 (Black Square)|Hélices|5|900|170
RV-10|Hélices|3|850|165
Cessna T210N Centurion II|Hélices|5|900|180
Cessna T207A Stationair 8|Hélices|7|650|150
Cessna 337 Skymaster II|Hélices|5|900|170
Cessna 414A|Hélices|7|1000|210
Piper PA-44 Seminole|Hélices|3|700|160
Cirrus SR22T G6|Hélices|3|900|200
Piper PA-30 Twin Comanche|Hélices|3|1000|175
Cessna 310R|Hélices|5|1000|190
Mooney M20R|Hélices|3|950|175
Cessna 400 Corvalis TT|Hélices|3|1000|210
PA-34 Seneca|Hélices|6|800|180
Beechcraft Bonanza G36|Hélices|5|920|175
Tecnam P2006T MKII|Hélices|3|650|140
Cessna 404 Titan|Hélices|9|1100|200
Diamond DA42|Hélices|3|1000|160
Diamond DA62|Hélices|6|1200|180
Douglas DC-3|Hélices|26|1200|160
Curtiss C-46 Commando|Turboélices|40|1000|200
Mitsubishi MU-2|Turboélices|9|1300|290
De Havilland Canada DHC-4 Caribou|Turboélices|32|1100|155
Beechcraft Model 18|Turboélices|8|900|190
Douglas DC-6|Turboélices|68|3000|270
Britten-Norman BN2 Islander|Turboélices|9|700|140
Britten-Norman BN2A Trislander|Turboélices|17|700|145
Piper PA-46-500TP|Turboélices|5|1000|260
Embraer 121 Xingu|Turboélices|9|1200|250
Sws Kodiak 100|Turboélices|9|1000|170
Cessna F406 Caravan II|Turboélices|12|1150|220
Cessna 208 B Grand Caravan EX|Turboélices|13|900|180
Piper M600|Turboélices|5|1400|270
Socata TBM 850|Turboélices|6|1400|300
Daher TBM 930|Turboélices|6|1700|320
King Air C90GTX|Turboélices|7|1200|260
Beechcraft Starship|Turboélices|6|1500|330
Embraer Emb-110 Bandeirante|Turboélices|21|1000|220
Pilatus PC-12|Turboélices|9|1800|270
Beechcraft King Air B200|Turboélices|9|1500|280
Piaggio P180 Avanti|Turboélices|9|1450|360
Dornier 228-212|Turboélices|19|700|220
DHC-6 Twin Otter|Turboélices|19|750|160
Cessna 408 Skycourier|Turboélices|19|900|200
Beechcraft King Air 350i|Turboélices|12|1800|300
Shorts SD3-30|Turboélices|33|450|190
Shorts SD3-60|Turboélices|36|600|200
Saab 340B|Turboélices|34|900|280
Fokker F27|Turboélices|52|1000|250
NAMC YS-11|Turboélices|60|1200|250
Fokker F50|Turboélices|50|1100|270
ATR 42-600|Turboélices|48|700|290
Bombardier 35A Learjet|Jatos|8|2000|420
Cirrus Sf50 Vision Jet|Jatos|6|1200|300
Cirrus Vision Jet G2|Jatos|6|1270|310
Cessna Citation Mustang|Jatos|5|1150|340
Embraer Phenom 100|Jatos|5|1170|390
HondaJet HA-420|Jatos|6|1400|420
Cessna Citation CJ3 Livtoair|Jatos|9|2000|410
Cessna Citation CJ4|Jatos|10|2150|430
Pilatus PC-24|Jatos|10|2000|425
Embraer Phenom 300E|Jatos|8|2000|450
Hawker 800XP|Jatos|8|2500|430
Dassault Falcon 50|Jatos|9|3200|450
Cessna 750 Citation X|Jatos|12|3200|500
Bombardier CRJ|Jatos|50|1300|430
Cessna Citation Sovereign|Jatos|12|3000|450
Cessna Citation Longitude|Jatos|10|3500|470
Fokker F28 Fellowship|Linha Aérea|65|1000|420
Avro RJ70|Linha Aérea|82|1500|400
Douglas DC-9|Linha Aérea|90|1300|440
Avro RJ85|Linha Aérea|100|1500|400
British Aerospace 146|Linha Aérea|112|1500|400
ATR 72-600|Linha Aérea|70|820|275
Bombardier CRJ 550|Linha Aérea|50|1200|440
Bombardier CRJ 700|Linha Aérea|78|1400|450
Boeing 727 Freighter|Linha Aérea|155|2300|470
Boeing 707-320C|Linha Aérea|194|3900|470
Fokker 70|Linha Aérea|72|1800|420
Bombardier CRJ 900|Linha Aérea|90|1500|450
Embraer E170|Linha Aérea|80|2100|450
Bombardier CRJ 1000|Linha Aérea|104|1600|450
Embraer E175|Linha Aérea|88|2200|450
Douglas MD-82|Linha Aérea|172|2000|440
Fokker 100|Linha Aérea|97|1300|420
Embraer E190|Linha Aérea|114|2400|450
Embraer E195|Linha Aérea|122|2200|450
Boeing 717|Linha Aérea|134|1400|440
Boeing 737-600|Linha Aérea|130|3000|450
Boeing 737-700|Linha Aérea|149|3000|450
Airbus A220-100|Linha Aérea|135|3400|450
Airbus A220-300|Linha Aérea|160|3300|450
Airbus A319|Linha Aérea|145|3700|450
Airbus A310-300|Linha Aérea|240|4300|460
Airbus A320 Fenix (ceo)|Linha Aérea|180|3000|450
Airbus A320neo|Linha Aérea|186|3400|450
Boeing 737-800|Linha Aérea|184|2900|450
Airbus A300-600|Linha Aérea|274|4000|460
Boeing 757-200|Linha Aérea|239|3900|460
Boeing 737-900ER|Linha Aérea|189|2900|450
Airbus A321|Linha Aérea|220|3200|450
Boeing 737 MAX|Linha Aérea|189|3500|450
Airbus A400M|Linha Aérea|116|3300|420
Douglas MD-11|Linha Aérea|381|6700|480
Airbus A330|Linha Aérea|335|6300|470
Airbus A340-600|Linha Aérea|440|7800|480
Airbus A350-900|Linha Aérea|315|8000|488
Boeing 787-10 Dreamliner|Linha Aérea|390|6300|488
Airbus A350-1000|Linha Aérea|369|8700|488
Boeing 777|Linha Aérea|320|7300|490
Boeing 747-8|Linha Aérea|410|7700|490
Airbus A380|Linha Aérea|471|8000|490`.split("\n").map(line => {
  const [name, group, pax, range, speed] = line.split("|");
  return { name, group, pax: Number(pax), range: Number(range), speed: Number(speed) };
});

const normalizeModel = text => String(text || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
const catalogByModel = new Map(aircraftCatalog.map(item => [normalizeModel(item.name), item]));

// Nome exato do PilOps primeiro; depois um nome que contenha o outro (ex.: "Cessna 208B Grand Caravan EX").
function catalogEntry(model) {
  const key = normalizeModel(model);
  if (!key) return null;
  return catalogByModel.get(key) || aircraftCatalog.find(item => {
    const other = normalizeModel(item.name);
    return other.includes(key) || key.includes(other);
  }) || null;
}

function performanceOf(model) {
  const entry = catalogEntry(model);
  return entry ? { range: entry.range, speed: entry.speed } : null;
}

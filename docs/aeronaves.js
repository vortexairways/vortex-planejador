// Catálogo do Mercado de Aeronaves do PilOps (lido em 04/11/2026: 135 modelos).
// Nome | grupo no PilOps | preço (P$) | passageiros | alcance (nm) | cruzeiro (kt TAS)
// Nome, grupo, preço e passageiros vêm do PilOps. O PilOps não publica alcance: alcance e cruzeiro são
// valores de catálogo dos fabricantes com carga típica e reservas, arredondados para baixo. Servem para
// triagem de rotas; combustível, carga e vento continuam sendo decididos no PilOps/MSFS.
const aircraftCatalog = `Piper J-3C Cub|Hélices|8000|1|190|65
Beechcraft Bonanza V35|Hélices|10000|5|750|165
Piper PA-24 Comanche|Hélices|10000|4|800|160
Kitfox Series 5|Hélices|12000|1|400|100
Beechcraft B60 Duke|Hélices|14000|5|1000|220
Cessna 152|Hélices|14000|1|410|105
PA-24-250 Comanche|Hélices|15000|4|800|160
Cessna 170B|Hélices|16000|3|500|105
Beechcraft Baron B55|Hélices|18000|6|950|190
Cessna 172 Skyhawk|Hélices|20000|3|640|120
A2A Aerostar 600|Hélices|20000|5|1000|220
Beechcraft D17 Staggerwing|Hélices|25000|4|650|175
Beechcraft B58 Baron|Hélices|30000|5|1300|200
Cessna 182|Hélices|30000|3|900|140
Wilga (PZL-104)|Hélices|30000|3|350|100
Piper PA-28 Arrow III|Hélices|30000|3|800|135
Tecnam P2010|Hélices|35000|3|650|130
Cessna A185F Skywagon|Hélices|38000|5|700|140
Rockwell Commander 114|Hélices|38000|3|800|155
De Havilland DHC-2 Beaver|Hélices|40000|6|390|120
Beechcraft C24R Sierra|Hélices|40000|3|600|140
Diamond DA40NG|Hélices|40000|3|750|140
Beechcraft Bonanza F33A|Hélices|40000|3|800|170
GippsAero GA8 Airvan|Hélices|45000|7|650|125
Beechcraft Bonanza A36 (Black Square)|Hélices|45000|5|900|170
RV-10|Hélices|45000|3|850|165
Cessna T210N Centurion II|Hélices|45000|5|900|180
Cessna T207A Stationair 8|Hélices|46000|7|650|150
Cessna 337 Skymaster II|Hélices|50000|5|900|170
Cessna 414A|Hélices|50000|7|1000|210
Piper PA-44 Seminole|Hélices|50000|3|700|160
Cirrus SR22T G6|Hélices|55000|3|900|200
Piper PA-30 Twin Comanche|Hélices|55000|3|1000|175
Cessna 310R|Hélices|55000|5|1000|190
Mooney M20R|Hélices|55000|3|950|175
Cessna 400 Corvalis TT|Hélices|55000|3|1000|210
PA-34 Seneca|Hélices|60000|6|800|180
Beechcraft Bonanza G36|Hélices|60000|5|920|175
Tecnam P2006T MKII|Hélices|70000|3|650|140
Cessna 404 Titan|Hélices|70000|9|1100|200
Diamond DA42|Hélices|80000|3|1000|160
Diamond DA62|Hélices|90000|6|1200|180
Douglas DC-3|Hélices|160000|26|1200|160
Curtiss C-46 Commando|Turboélices|120000|40|1000|200
Mitsubishi MU-2|Turboélices|125000|9|1300|290
De Havilland Canada DHC-4 Caribou|Turboélices|135000|32|1100|155
Beechcraft Model 18|Turboélices|135000|8|900|190
Douglas DC-6|Turboélices|200000|68|3000|270
Britten-Norman BN2 Islander|Turboélices|200000|9|700|140
Britten-Norman BN2A Trislander|Turboélices|240000|17|700|145
Piper PA-46-500TP|Turboélices|300000|5|1000|260
Embraer 121 Xingu|Turboélices|300000|9|1200|250
Sws Kodiak 100|Turboélices|330000|9|1000|170
Cessna F406 Caravan II|Turboélices|340000|12|1150|220
Cessna 208 B Grand Caravan EX|Turboélices|350000|13|900|180
Piper M600|Turboélices|450000|5|1400|270
Socata TBM 850|Turboélices|500000|6|1400|300
Daher TBM 930|Turboélices|550000|6|1700|320
King Air C90GTX|Turboélices|620000|7|1200|260
Beechcraft Starship|Turboélices|650000|6|1500|330
Embraer Emb-110 Bandeirante|Turboélices|660000|21|1000|220
Pilatus PC-12|Turboélices|700000|9|1800|270
Beechcraft King Air B200|Turboélices|800000|9|1500|280
Piaggio P180 Avanti|Turboélices|800000|9|1450|360
Dornier 228-212|Turboélices|850000|19|700|220
DHC-6 Twin Otter|Turboélices|900000|19|750|160
Cessna 408 Skycourier|Turboélices|900000|19|900|200
Beechcraft King Air 350i|Turboélices|1000000|12|1800|300
Shorts SD3-30|Turboélices|1000000|33|450|190
Shorts SD3-60|Turboélices|1200000|36|600|200
Saab 340B|Turboélices|1200000|34|900|280
Fokker F27|Turboélices|1400000|52|1000|250
NAMC YS-11|Turboélices|1600000|60|1200|250
Fokker F50|Turboélices|2000000|50|1100|270
ATR 42-600|Turboélices|2800000|48|700|290
Bombardier 35A Learjet|Jatos|350000|8|2000|420
Cirrus Sf50 Vision Jet|Jatos|400000|6|1200|300
Cirrus Vision Jet G2|Jatos|450000|6|1270|310
Cessna Citation Mustang|Jatos|500000|5|1150|340
Embraer Phenom 100|Jatos|700000|5|1170|390
HondaJet HA-420|Jatos|750000|6|1400|420
Cessna Citation CJ3 Livtoair|Jatos|1250000|9|2000|410
Cessna Citation CJ4|Jatos|1700000|10|2150|430
Pilatus PC-24|Jatos|2000000|10|2000|425
Embraer Phenom 300E|Jatos|2200000|8|2000|450
Hawker 800XP|Jatos|2500000|8|2500|430
Dassault Falcon 50|Jatos|3600000|9|3200|450
Cessna 750 Citation X|Jatos|3600000|12|3200|500
Bombardier CRJ|Jatos|4200000|50|1300|430
Cessna Citation Sovereign|Jatos|4200000|12|3000|450
Cessna Citation Longitude|Jatos|5000000|10|3500|470
Fokker F28 Fellowship|Linha Aérea|2150000|65|1000|420
Avro RJ70|Linha Aérea|2200000|82|1500|400
Douglas DC-9|Linha Aérea|2460000|90|1300|440
Avro RJ85|Linha Aérea|2700000|100|1500|400
British Aerospace 146|Linha Aérea|3000000|112|1500|400
ATR 72-600|Linha Aérea|4000000|70|820|275
Bombardier CRJ 550|Linha Aérea|4500000|50|1200|440
Bombardier CRJ 700|Linha Aérea|6200000|78|1400|450
Boeing 727 Freighter|Linha Aérea|6400000|155|2300|470
Boeing 707-320C|Linha Aérea|6400000|194|3900|470
Fokker 70|Linha Aérea|7000000|72|1800|420
Bombardier CRJ 900|Linha Aérea|7000000|90|1500|450
Embraer E170|Linha Aérea|7500000|80|2100|450
Bombardier CRJ 1000|Linha Aérea|7800000|104|1600|450
Embraer E175|Linha Aérea|8000000|88|2200|450
Douglas MD-82|Linha Aérea|8000000|172|2000|440
Fokker 100|Linha Aérea|8200000|97|1300|420
Embraer E190|Linha Aérea|8500000|114|2400|450
Embraer E195|Linha Aérea|9500000|122|2200|450
Boeing 717|Linha Aérea|11000000|134|1400|440
Boeing 737-600|Linha Aérea|13000000|130|3000|450
Boeing 737-700|Linha Aérea|15000000|149|3000|450
Airbus A220-100|Linha Aérea|17000000|135|3400|450
Airbus A220-300|Linha Aérea|18000000|160|3300|450
Airbus A319|Linha Aérea|19000000|145|3700|450
Airbus A310-300|Linha Aérea|19500000|240|4300|460
Airbus A320 Fenix (ceo)|Linha Aérea|22000000|180|3000|450
Airbus A320neo|Linha Aérea|24000000|186|3400|450
Boeing 737-800|Linha Aérea|24000000|184|2900|450
Airbus A300-600|Linha Aérea|25000000|274|4000|460
Boeing 757-200|Linha Aérea|26000000|239|3900|460
Boeing 737-900ER|Linha Aérea|26000000|189|2900|450
Airbus A321|Linha Aérea|27000000|220|3200|450
Boeing 737 MAX|Linha Aérea|28000000|189|3500|450
Airbus A400M|Linha Aérea|35000000|116|3300|420
Douglas MD-11|Linha Aérea|45000000|381|6700|480
Airbus A330|Linha Aérea|150000000|335|6300|470
Airbus A340-600|Linha Aérea|175000000|440|7800|480
Airbus A350-900|Linha Aérea|200000000|315|8000|488
Boeing 787-10 Dreamliner|Linha Aérea|210000000|390|6300|488
Airbus A350-1000|Linha Aérea|240000000|369|8700|488
Boeing 777|Linha Aérea|250000000|320|7300|490
Boeing 747-8|Linha Aérea|300000000|410|7700|490
Airbus A380|Linha Aérea|360000000|471|8000|490`.split("\n").map(line => {
  const [name, group, price, pax, range, speed] = line.split("|");
  return { name, group, price: Number(price), pax: Number(pax), range: Number(range), speed: Number(speed) };
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

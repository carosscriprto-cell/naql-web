import type { BusType, City, Company, TripSearchItem } from "@/types/domain";

const uuid = (prefix: string, n: number) =>
  `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const cities: City[] = [
  { id: uuid("c1", 1), nameAr: "دمشق", nameEn: "Damascus", slug: "damascus" },
  { id: uuid("c1", 2), nameAr: "حلب", nameEn: "Aleppo", slug: "aleppo" },
  { id: uuid("c1", 3), nameAr: "حمص", nameEn: "Homs", slug: "homs" },
  { id: uuid("c1", 4), nameAr: "اللاذقية", nameEn: "Latakia", slug: "latakia" },
  {
    id: uuid("c1", 5),
    nameAr: "دير الزور",
    nameEn: "Deir ez-Zor",
    slug: "deir-ez-zor",
  },
  { id: uuid("c1", 6), nameAr: "طرطوس", nameEn: "Tartus", slug: "tartus" },
];

// Slug is mock-only (used for /companies/[slug] links); the API contract's
// Company shape has no slug field, so it stays out of src/types/domain.ts.
export const companies: (Company & { slug: string })[] = [
  {
    id: uuid("a1", 1),
    name: "الأمانة",
    slug: "al-amana",
    logoUrl: "/logos/al-amana.png",
    rating: 4.6,
    tripsCount: 128,
  },
  {
    id: uuid("a1", 2),
    name: "القدموس",
    slug: "al-kadmous",
    logoUrl: "/logos/al-kadmous.png",
    rating: 4.8,
    tripsCount: 214,
  },
  {
    id: uuid("a1", 3),
    name: "الأهلية",
    slug: "al-ahlia",
    logoUrl: "/logos/al-ahlia.png",
    rating: 4.2,
    tripsCount: 96,
  },
];

const [damascus, aleppo, homs, latakia, , tartus] = cities;
const [alAmana, alKadmous, alAhlia] = companies;

// Syria is permanently UTC+3 (no DST since 2022).
const SYRIA_UTC_OFFSET_HOURS = 3;

/** ISO UTC instant for a Syria-local time of day, `daysFromToday` days ahead. */
function syriaLocal(daysFromToday: number, hour: number, minute: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysFromToday,
      hour - SYRIA_UTC_OFFSET_HOURS,
      minute,
    ),
  );
}

type TripSeed = {
  n: number;
  company: Company;
  from: City;
  to: City;
  hour: number;
  minute: number;
  durationMin: number;
  price: number;
  busType: BusType;
  availableSeats: number;
};

function makeTrip(seed: TripSeed): TripSearchItem {
  const departure = syriaLocal(1, seed.hour, seed.minute);
  const arrival = new Date(departure.getTime() + seed.durationMin * 60_000);
  return {
    id: uuid("e1", seed.n),
    company: {
      id: seed.company.id,
      name: seed.company.name,
      logoUrl: seed.company.logoUrl,
      rating: seed.company.rating,
    },
    fromCity: { id: seed.from.id, nameAr: seed.from.nameAr },
    toCity: { id: seed.to.id, nameAr: seed.to.nameAr },
    departureAt: departure.toISOString(),
    arrivalAt: arrival.toISOString(),
    price: seed.price,
    currency: "SYP",
    availableSeats: seed.availableSeats,
    busType: seed.busType,
  };
}

// 12 trips (departing tomorrow, Syria time) across دمشق→حلب, دمشق→حمص, دمشق→اللاذقية.
const tripSeeds: TripSeed[] = [
  // دمشق → حلب (~5h)
  {
    n: 1,
    company: alAmana,
    from: damascus,
    to: aleppo,
    hour: 7,
    minute: 0,
    durationMin: 300,
    price: 110000,
    busType: "VIP",
    availableSeats: 28,
  },
  {
    n: 2,
    company: alKadmous,
    from: damascus,
    to: aleppo,
    hour: 9,
    minute: 30,
    durationMin: 315,
    price: 85000,
    busType: "عادي",
    availableSeats: 34,
  },
  {
    n: 3,
    company: alAhlia,
    from: damascus,
    to: aleppo,
    hour: 14,
    minute: 0,
    durationMin: 300,
    price: 115000,
    busType: "VIP",
    availableSeats: 12,
  },
  {
    n: 4,
    company: alKadmous,
    from: damascus,
    to: aleppo,
    hour: 22,
    minute: 30,
    durationMin: 330,
    price: 90000,
    busType: "عادي",
    availableSeats: 40,
  },
  // دمشق → حمص (~2h)
  {
    n: 5,
    company: alAmana,
    from: damascus,
    to: homs,
    hour: 6,
    minute: 30,
    durationMin: 120,
    price: 60000,
    busType: "عادي",
    availableSeats: 38,
  },
  {
    n: 6,
    company: alKadmous,
    from: damascus,
    to: homs,
    hour: 11,
    minute: 0,
    durationMin: 120,
    price: 65000,
    busType: "عادي",
    availableSeats: 22,
  },
  {
    n: 7,
    company: alAhlia,
    from: damascus,
    to: homs,
    hour: 16,
    minute: 30,
    durationMin: 105,
    price: 75000,
    busType: "VIP",
    availableSeats: 18,
  },
  {
    n: 8,
    company: alAmana,
    from: damascus,
    to: homs,
    hour: 19,
    minute: 0,
    durationMin: 120,
    price: 62000,
    busType: "عادي",
    availableSeats: 5,
  },
  // دمشق → اللاذقية (~4h)
  {
    n: 9,
    company: alKadmous,
    from: damascus,
    to: latakia,
    hour: 8,
    minute: 0,
    durationMin: 240,
    price: 100000,
    busType: "VIP",
    availableSeats: 26,
  },
  {
    n: 10,
    company: alAhlia,
    from: damascus,
    to: latakia,
    hour: 10,
    minute: 30,
    durationMin: 255,
    price: 80000,
    busType: "عادي",
    availableSeats: 31,
  },
  {
    n: 11,
    company: alAmana,
    from: damascus,
    to: latakia,
    hour: 15,
    minute: 0,
    durationMin: 240,
    price: 105000,
    busType: "VIP",
    availableSeats: 9,
  },
  {
    n: 12,
    company: alAhlia,
    from: damascus,
    to: latakia,
    hour: 18,
    minute: 30,
    durationMin: 270,
    price: 82000,
    busType: "عادي",
    availableSeats: 36,
  },
];

export const trips: TripSearchItem[] = tripSeeds.map(makeTrip);

export function getCities(): City[] {
  return cities;
}

export type PopularRoute = {
  fromCity: City;
  toCity: City;
  minPrice: number;
  tripsPerDay: number;
};

const minPriceFor = (from: City, to: City) =>
  Math.min(
    ...trips
      .filter((t) => t.fromCity.id === from.id && t.toCity.id === to.id)
      .map((t) => t.price),
  );

export function getPopularRoutes(): PopularRoute[] {
  return [
    {
      fromCity: damascus,
      toCity: aleppo,
      minPrice: minPriceFor(damascus, aleppo),
      tripsPerDay: 8,
    },
    {
      fromCity: damascus,
      toCity: homs,
      minPrice: minPriceFor(damascus, homs),
      tripsPerDay: 12,
    },
    {
      fromCity: damascus,
      toCity: latakia,
      minPrice: minPriceFor(damascus, latakia),
      tripsPerDay: 6,
    },
    { fromCity: damascus, toCity: tartus, minPrice: 65000, tripsPerDay: 4 },
  ];
}

/**
 * `from`/`to` are city slugs; `date` is the departure day ("yyyy-MM-dd", Syria time).
 * Mock trips depart tomorrow, so results are rebased onto the requested date —
 * any date the UI allows (min today) returns a full result set for the demo.
 */
export function searchTrips(
  from: string,
  to: string,
  date: string,
): TripSearchItem[] {
  const fromCity = cities.find((c) => c.slug === from);
  const toCity = cities.find((c) => c.slug === to);
  if (!fromCity || !toCity) return [];

  const matches = trips.filter(
    (t) => t.fromCity.id === fromCity.id && t.toCity.id === toCity.id,
  );

  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return matches;

  return matches.map((trip) => {
    const dep = new Date(trip.departureAt);
    const dayShiftMs =
      Date.UTC(y, m - 1, d) -
      Date.UTC(dep.getUTCFullYear(), dep.getUTCMonth(), dep.getUTCDate());
    return {
      ...trip,
      departureAt: new Date(dep.getTime() + dayShiftMs).toISOString(),
      arrivalAt: new Date(
        new Date(trip.arrivalAt).getTime() + dayShiftMs,
      ).toISOString(),
    };
  });
}

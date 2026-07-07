import { http, HttpResponse } from "msw";

import { env } from "@/config/env";
import { getCities, searchTrips } from "./data";

const url = (path: string) => `${env.NEXT_PUBLIC_API_URL}${path}`;

// Response shapes per docs/BACKEND_V1.md: §2 shows GET /cities as a plain
// array; GET /trips/search is a list endpoint, so it gets the §0 pagination
// envelope { data, meta }.
export const handlers = [
  http.get(url("/cities"), () => HttpResponse.json(getCities())),

  http.get(url("/trips/search"), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const data = searchTrips(
      params.get("from") ?? "",
      params.get("to") ?? "",
      params.get("date") ?? "",
    );
    return HttpResponse.json({
      data,
      meta: { page: 1, perPage: 20, total: data.length },
    });
  }),
];

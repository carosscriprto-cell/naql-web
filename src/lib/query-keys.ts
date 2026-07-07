export const queryKeys = {
  cities: { all: ["cities"] as const },
  trips: {
    search: (p: Record<string, string>) => ["trips", "search", p] as const,
    detail: (id: string) => ["trips", id] as const,
    seats: (id: string) => ["trips", id, "seats"] as const,
  },
  bookings: {
    mine: () => ["bookings", "mine"] as const,
    detail: (id: string) => ["bookings", id] as const,
  },
} as const;

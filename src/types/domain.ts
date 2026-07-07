// Mirrors docs/BACKEND_V1.md §2–4 (API contract). Shape changes must be agreed with backend.

export type City = {
  id: string;
  nameAr: string;
  nameEn: string;
  slug: string;
};

export type Company = {
  id: string;
  name: string;
  logoUrl: string;
  rating: number;
  tripsCount: number;
};

export type BusType = "عادي" | "VIP";

export type TripSearchItem = {
  id: string;
  company: Pick<Company, "id" | "name" | "logoUrl" | "rating">;
  fromCity: Pick<City, "id" | "nameAr">;
  toCity: Pick<City, "id" | "nameAr">;
  departureAt: string;
  arrivalAt: string;
  price: number;
  currency: "SYP";
  availableSeats: number;
  busType: BusType;
};

export type SeatStatus = "available" | "locked" | "booked";

export type Seat = {
  number: string;
  row: number;
  col: number;
  status: SeatStatus;
};

export type SeatMap = {
  layout: {
    rows: number;
    cols: number;
    aisleAfterCol: number;
  };
  seats: Seat[];
};

export type BookingStatus = "confirmed" | "cancelled";

export type BookingPassenger = {
  seatNumber: string;
  fullName: string;
  phone: string;
};

export type Booking = {
  id: string;
  pnr: string;
  status: BookingStatus;
  qrPayload: string;
  trip: TripSearchItem;
  passengers: BookingPassenger[];
  totalPrice: number;
};

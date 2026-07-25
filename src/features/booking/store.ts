import { create } from "zustand";
import type { Booking, Gender } from "./schemas";

export type SelectedSeat = { seatNumber: string; gender: Gender };

// The single booking-flow store (CLAUDE.md). Lock/checkout fields are added by
// later tasks; Task 11 owns only seat selection.
type BookingState = {
  selectedSeats: SelectedSeat[];
  /** Trip the current lock belongs to — used to navigate back on expiry. */
  tripId: string | null;
  lockId: string | null;
  /** ISO server time the lock expires; the countdown derives from this. */
  lockExpiresAt: string | null;
  /** Generated once per lock (checkout attempt); reused on every retry (§4). */
  idempotencyKey: string | null;
  booking: Booking | null;
  /** Toggle a seat, capped at `maxSeats` (the passengers URL param). */
  toggleSeat: (seatNumber: string, maxSeats: number) => void;
  setSeatGender: (seatNumber: string, gender: Gender) => void;
  /** Remove seats that a refetch revealed as locked/booked (PAS-4 AC-5). */
  dropSeats: (seatNumbers: string[]) => void;
  clearSelection: () => void;
  setLock: (lockId: string, lockExpiresAt: string, tripId: string) => void;
  clearLock: () => void;
  /** Force the countdown to zero (e.g. a LOCK_EXPIRED booking response). */
  expireLock: () => void;
  setBooking: (booking: Booking) => void;
  clearBooking: () => void;
};

export const useBookingStore = create<BookingState>((set) => ({
  selectedSeats: [],
  tripId: null,
  lockId: null,
  lockExpiresAt: null,
  idempotencyKey: null,
  booking: null,
  toggleSeat: (seatNumber, maxSeats) =>
    set((state) => {
      const existing = state.selectedSeats.some(
        (s) => s.seatNumber === seatNumber,
      );
      if (existing) {
        return {
          selectedSeats: state.selectedSeats.filter(
            (s) => s.seatNumber !== seatNumber,
          ),
        };
      }
      if (state.selectedSeats.length >= maxSeats) return state;
      return {
        selectedSeats: [...state.selectedSeats, { seatNumber, gender: "male" }],
      };
    }),
  setSeatGender: (seatNumber, gender) =>
    set((state) => ({
      selectedSeats: state.selectedSeats.map((s) =>
        s.seatNumber === seatNumber ? { ...s, gender } : s,
      ),
    })),
  dropSeats: (seatNumbers) =>
    set((state) => ({
      selectedSeats: state.selectedSeats.filter(
        (s) => !seatNumbers.includes(s.seatNumber),
      ),
    })),
  clearSelection: () => set({ selectedSeats: [] }),
  setLock: (lockId, lockExpiresAt, tripId) =>
    set({ lockId, lockExpiresAt, tripId, idempotencyKey: crypto.randomUUID() }),
  clearLock: () => set({ lockId: null, lockExpiresAt: null }),
  expireLock: () =>
    set({ lockExpiresAt: new Date(Date.now() - 1000).toISOString() }),
  setBooking: (booking) => set({ booking }),
  clearBooking: () => set({ booking: null }),
}));

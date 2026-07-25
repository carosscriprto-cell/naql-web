import { TripDetail } from "@/features/search/components/trip-detail";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TripDetail id={id} />;
}

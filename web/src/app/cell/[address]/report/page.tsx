import { Report } from "@/components/report";

export default async function ReportPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <Report address={address} />;
}

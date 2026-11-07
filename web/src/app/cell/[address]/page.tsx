import { Cell } from "@/components/cell";

export default async function CellPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <Cell address={address} />;
}

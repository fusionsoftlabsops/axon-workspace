import { redirect } from 'next/navigation';

export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/projects/${slug}/board`);
}

import { ProfilePage } from '@/app/_discovery/profile-page';
export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <ProfilePage userId={userId} />;
}

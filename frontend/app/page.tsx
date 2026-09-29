import { auth } from "@/auth";
import { SiteNav } from "@/components/landing/site-nav";
import { Hero } from "@/components/landing/hero";
import { Bento } from "@/components/landing/bento";
import { Pipeline } from "@/components/landing/pipeline";
import { Pricing } from "@/components/landing/pricing";
import { FooterCta } from "@/components/landing/footer-cta";

export default async function LandingPage() {
  const session = await auth();
  const signedIn = !!session?.user;

  return (
    <div className="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden">
      <SiteNav signedIn={signedIn} />
      <main className="flex-1">
        <Hero signedIn={signedIn} />
        <Bento />
        <Pipeline signedIn={signedIn} />
        <Pricing />
      </main>
      <FooterCta signedIn={signedIn} />
    </div>
  );
}

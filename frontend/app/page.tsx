import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  MousePointerClick,
  Download,
  Mic,
  Captions,
  Gamepad2,
  MessageCircle,
  Zap,
  ShieldCheck,
} from "lucide-react";

const steps = [
  {
    icon: Search,
    step: "1",
    title: "Search Reddit",
    description: "Find posts by keyword across any subreddit.",
  },
  {
    icon: MousePointerClick,
    step: "2",
    title: "Pick a Post",
    description: "Choose a story and configure voice, style, and length.",
  },
  {
    icon: Download,
    step: "3",
    title: "Download Your Reel",
    description: "Get a ready-to-post 1080×1920 MP4 in minutes.",
  },
];

const features = [
  {
    icon: Mic,
    title: "AI Voiceover",
    description: "Natural narration of the full post text.",
  },
  {
    icon: Captions,
    title: "Auto-Subtitles",
    description: "Word-synced captions burned into the frame.",
  },
  {
    icon: Gamepad2,
    title: "Gameplay Backgrounds",
    description: "Looping clips that keep viewers watching.",
  },
  {
    icon: MessageCircle,
    title: "Reddit Search",
    description: "Browse and filter posts without leaving the app.",
  },
  {
    icon: Zap,
    title: "One-Click Download",
    description: "Finished MP4, optimized for Shorts and Reels.",
  },
  {
    icon: ShieldCheck,
    title: "Quota-Free Admin",
    description: "Admin accounts generate without limits.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Reel<span className="text-primary">Bot</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-28 text-center">
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
            Reddit posts to viral reels.
            <br />
            <span className="text-muted-foreground">In one click.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            ReelBot turns any Reddit story into a short-form vertical video with an
            AI voiceover, word-synced subtitles, and a looping gameplay background.
          </p>
          <div className="mt-10 flex items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/sign-up">Start Creating</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        </section>

        {/* How It Works */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            How It Works
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <Card key={s.step}>
                <CardContent className="flex flex-col items-start gap-4 p-6">
                  <div className="flex w-full items-center justify-between">
                    <s.icon className="size-8 text-primary" />
                    <Badge variant="outline">{s.step}</Badge>
                  </div>
                  <div>
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {s.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            Features
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title}>
                <CardContent className="flex items-start gap-4 p-6">
                  <f.icon className="mt-0.5 size-6 shrink-0 text-primary" />
                  <div>
                    <h3 className="font-medium">{f.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {f.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            Pricing
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Card>
              <CardContent className="flex flex-col gap-4 p-8">
                <Badge variant="secondary" className="w-fit">Free</Badge>
                <p className="text-4xl font-bold">$0</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>3 videos per day</li>
                  <li>30 videos per month</li>
                  <li>All voices and styles</li>
                </ul>
                <Button variant="outline" className="mt-2" asChild>
                  <Link href="/sign-up">Get Started</Link>
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex flex-col gap-4 p-8">
                <Badge className="w-fit">Admin</Badge>
                <p className="text-4xl font-bold">Unlimited</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>No generation limits</li>
                  <li>Asset management panel</li>
                  <li>User &amp; job oversight</li>
                </ul>
                <Button variant="outline" className="mt-2" disabled>
                  Invite Only
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <p>Built with ReelBot</p>
          <Separator orientation="vertical" className="hidden h-4 sm:block" />
          <div className="flex items-center gap-6">
            <Link href="/sign-in" className="hover:text-foreground">
              Sign In
            </Link>
            <Link href="/sign-up" className="hover:text-foreground">
              Sign Up
            </Link>
            <a
              href="https://www.reddit.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              Reddit
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

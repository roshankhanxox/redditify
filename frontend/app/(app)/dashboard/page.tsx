import Link from "next/link";
import { ArrowRight, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-8">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Turn any story into a short-form vertical video.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-brand/40 bg-brand/[0.04]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
              <Clapperboard className="size-5 text-brand" />
              Create a new reel
            </CardTitle>
            <CardDescription>
              Paste a story, pick a voice, generate a vertical video with synced captions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/create">
                Start creating
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg font-semibold tracking-tight">
              Your recent reels
            </CardTitle>
            <CardDescription>
              Track progress and re-download finished videos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/dashboard/reels">
                Open My Reels
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

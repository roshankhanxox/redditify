"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { api } from "@/lib/api";
import { UserBackgroundPanel } from "@/components/background-picker";
import type { AssetList } from "@/lib/types";
import { VOICES, TTS_PROVIDERS } from "@/lib/voices";
import {
  DEFAULT_WIZARD_STATE,
  DURATIONS,
  STEPS,
  STEP_FIELDS,
  buildPayload,
  clearDraft,
  loadDraft,
  saveDraft,
  stateFromJob,
  wizardSchema,
  type WizardInput,
  type WizardState,
} from "@/lib/wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CustomizePanel, Segmented } from "@/components/customize-panel";
import { PhoneFramePreview } from "@/components/create/phone-preview";
import { Stepper } from "@/components/create/stepper";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

type FieldName = Extract<keyof WizardState, string>;

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[13px] font-medium text-destructive">{msg}</p>;
}

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {hint ? (
          <span className="text-[13px] tabular-nums text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function StoryWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [creating, setCreating] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    watch,
    trigger,
    reset,
    formState: { errors },
  } = useForm<WizardInput, unknown, WizardState>({
    resolver: zodResolver(wizardSchema),
    defaultValues: DEFAULT_WIZARD_STATE,
    mode: "onTouched",
  });

  // Draft restore (after hydration so SSR markup stays stable)
  const restoredOnce = useRef(false);

  // Regenerate prefill takes precedence over any saved draft.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (restoredOnce.current) return;
    const from = searchParams.get("from");
    if (!from) return;
    restoredOnce.current = true;
    api
      .get(`/jobs/${from}`)
      .then(({ data }) => {
        reset(stateFromJob(data));
        clearDraft("story");
        toast.info(
          `Settings loaded from "${(data.title || "untitled reel").slice(0, 60)}"`,
        );
        router.replace("/dashboard/create/story");
      })
      .catch(() => toast.error("Couldn't load that reel's settings"));
  }, [searchParams, reset, router]);

  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    const draft = loadDraft("story");
    if (draft && (draft.title || draft.story)) {
      reset(draft);
      toast.info("Draft restored", {
        description: "We kept your unfinished reel safe.",
      });
    }
  }, [reset]);

  // Debounced autosave
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sub = watch((values) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => saveDraft("story", values as WizardState),
        500,
      );
    });
    return () => sub.unsubscribe();
  }, [watch]);

  const { data: quota } = useSWR<{
    daily_used: number;
    daily_limit: number;
    unlimited?: boolean;
    plan?: string;
  }>("/quota/me", fetcher, { refreshInterval: 30_000 });
  const canRetain = quota?.plan === "premium" || quota?.unlimited;
  const { data: assetData } = useSWR<AssetList>("/assets", fetcher);

  const values = watch();
  const wordCount = values.story?.trim()
    ? values.story.trim().split(/\s+/).length
    : 0;

  async function goNext() {
    const fields = STEP_FIELDS[STEPS[step].id];
    const ok = await trigger(fields as FieldName[], { shouldFocus: true });
    if (!ok) {
      toast.error("Fix the highlighted fields to continue");
      return;
    }
    setStep((s) => {
      const next = Math.min(s + 1, STEPS.length - 1);
      setMaxVisited((m) => Math.max(m, next));
      return next;
    });
  }

  function goTo(i: number) {
    if (i <= maxVisited) setStep(i);
  }

  async function onSubmit(state: WizardState) {
    setCreating(true);
    try {
      const r = await api.post<{ job_id: string; duplicate: boolean }>(
        "/jobs",
        buildPayload(state),
      );
      clearDraft("story");
      toast.success(r.data.duplicate ? "Already rendering this story" : "Reel queued");
      router.push(`/dashboard/reels?highlight=${r.data.job_id}`);
    } catch (err: unknown) {
      type ErrShape = { response?: { data?: { detail?: string } } };
      const detail =
        (err as ErrShape)?.response?.data?.detail || "Could not create job";
      toast.error(detail);
    } finally {
      setCreating(false);
    }
  }

  const s = values;
  const err = errors as Record<string, { message?: string } | undefined>;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
      {/* Left — steps */}
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard/create"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            All formats
          </Link>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Story Reel
          </h1>
          <Stepper current={step} maxVisited={maxVisited} onStepClick={goTo} />
        </header>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)}>
          <Card>
            <CardContent className="flex flex-col gap-5 p-6">
              {step === 0 && (
                <>
                  <Row label="Title" hint={err.title ? undefined : `${(getValues().title ?? "").length}/300`}>
                    <Input
                      placeholder={'e.g. "AITA for returning my roommate\'s vacuum?"'}
                      aria-invalid={!!err.title}
                      {...register("title")}
                    />
                    <FieldError msg={err.title?.message} />
                  </Row>
                  <Row label="Subreddit label (optional)">
                    <Input placeholder="AskReddit" {...register("subreddit")} />
                  </Row>
                  <Row label="Story / post content" hint={`${wordCount} words`}>
                    <Textarea
                      rows={12}
                      className="resize-y"
                      placeholder="Paste the full post text here..."
                      aria-invalid={!!err.story}
                      {...register("story")}
                    />
                    <FieldError msg={err.story?.message} />
                  </Row>
                  <Row label="Max duration" hint={DURATIONS.find((d) => d.words === s.max_words)?.label}>
                    <Slider
                      min={0}
                      max={DURATIONS.length - 1}
                      step={1}
                      value={[DURATIONS.findIndex((d) => d.words === s.max_words)]}
                      onValueChange={([i]) =>
                        setValue("max_words", DURATIONS[i]?.words ?? 1200, {
                          shouldDirty: true,
                        })
                      }
                    />
                  </Row>
                </>
              )}

              {step === 1 && (
                <>
                  <Row label="Voice engine">
                    <RadioGroup
                      value={s.tts_provider}
                      onValueChange={(v) => setValue("tts_provider", v as WizardState["tts_provider"], { shouldDirty: true })}
                      className="flex flex-col gap-2"
                    >
                      {TTS_PROVIDERS.map((p) => (
                        <div key={p.id} className="flex items-center gap-2">
                          <RadioGroupItem value={p.id} id={`tts-${p.id}`} />
                          <Label htmlFor={`tts-${p.id}`} className="font-normal">
                            {p.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </Row>

                  <Row label="Voice">
                    <Select value={s.voice} onValueChange={(v) => setValue("voice", v, { shouldDirty: true })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Male", "Female", "Neutral"].map((group) => (
                          <div key={group}>
                            <p className="px-2 py-1 text-[13px] font-medium text-muted-foreground">
                              {group}
                            </p>
                            {VOICES.filter((v) => v.group === group).map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.label}
                              </SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>

                  <Row label="Speech speed" hint={`${s.speed.toFixed(2)}×`}>
                    <Slider
                      min={0.8}
                      max={1.5}
                      step={0.05}
                      value={[s.speed]}
                      onValueChange={([v]) => setValue("speed", v, { shouldDirty: true })}
                    />
                  </Row>

                  <Row label="Expressiveness">
                    <Segmented
                      value={s.expressiveness}
                      onChange={(v) => setValue("expressiveness", v, { shouldDirty: true })}
                      options={[
                        { value: "natural", label: "Natural" },
                        { value: "expressive", label: "Expressive" },
                        { value: "dramatic", label: "Dramatic" },
                      ]}
                    />
                  </Row>
                </>
              )}

              {step === 2 && (
                <>
                  <CustomizePanel
                    preview={false}
                    value={{
                      captions_enabled: s.captions_enabled,
                      caption_font_size: s.caption_font_size,
                      caption_position: s.caption_position,
                      caption_color: s.caption_color,
                      caption_outline: s.caption_outline,
                      caption_words: s.caption_words,
                      title_enabled: s.title_enabled,
                      title_position: s.title_position,
                      title_scale: s.title_scale,
                      title_style: s.title_style,
                      title_badge: s.title_badge,
                    }}
                    onChange={(patch) => {
                      for (const [k, v] of Object.entries(patch)) {
                        setValue(k as FieldName, v as never, { shouldDirty: true });
                      }
                    }}
                  />

                  <Row label="Gameplay background">
                    <RadioGroup
                      value={s.gameplay_source}
                      onValueChange={(v) => setValue("gameplay_source", v as WizardState["gameplay_source"], { shouldDirty: true })}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="library" id="bgsrc-library" />
                        <Label htmlFor="bgsrc-library" className="font-normal">Library</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="user" id="bgsrc-user" />
                        <Label htmlFor="bgsrc-user" className="font-normal">My footage</Label>
                      </div>
                    </RadioGroup>
                  </Row>

                  {s.gameplay_source === "library" ? (
                    <Row label="Clip category">
                      <Select value={s.gameplay_category} onValueChange={(v) => setValue("gameplay_category", v, { shouldDirty: true })}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(assetData?.categories ?? ["any"]).map((c) => (
                            <SelectItem key={c} value={c} className="capitalize">
                              {c === "any" ? "Any" : c.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Row>
                  ) : (
                    <UserBackgroundPicker
                      value={s.background_id || ""}
                      onChange={(id) => setValue("background_id", id, { shouldDirty: true })}
                      error={err.background_id?.message}
                    />
                  )}

                  <Row label="Keep the finished file?">
                    <RadioGroup
                      value={s.retention}
                      onValueChange={(v) => setValue("retention", v as WizardState["retention"], { shouldDirty: true })}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="ephemeral" id="ret-ephemeral" />
                        <Label htmlFor="ret-ephemeral" className="font-normal">Auto-delete (~15 min)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="retain" id="ret-retain" disabled={!canRetain} />
                        <Label htmlFor="ret-retain" className={`font-normal ${canRetain ? "" : "opacity-50"}`}>
                          Keep until I delete
                        </Label>
                        {!canRetain && (
                          <Badge variant="outline" className="text-xs uppercase tracking-wide">premium</Badge>
                        )}
                      </div>
                    </RadioGroup>
                  </Row>
                </>
              )}

              {step === 3 && (
                <ReviewSummary values={s} onEdit={goTo} />
              )}
            </CardContent>
          </Card>

          {/* Footer nav */}
          <div className="mt-5 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((v) => Math.max(0, v - 1))}
              disabled={step === 0}
            >
              <ChevronLeft />
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => void goNext()}>
                Continue
                <ChevronRight />
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Sparkles />
                    Generate Reel
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Right rail — live preview + quota */}
      <aside className="hidden flex-col gap-4 self-start lg:sticky lg:top-24 lg:flex">
        <PhoneFramePreview settings={s} className="mx-auto" />
        <Button
          variant="ghost"
          size="sm"
          className="mx-auto text-muted-foreground"
          onClick={() => reset({ ...DEFAULT_WIZARD_STATE })}
        >
          <RotateCcw />
          Reset all
        </Button>
        {quota && (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm font-medium">Quota</p>
            <Progress
              value={
                quota.unlimited
                  ? 0
                  : (quota.daily_used / Math.max(1, quota.daily_limit)) * 100
              }
              className="mt-2 h-1.5"
            />
            <p className="mt-2 text-[13px] tabular-nums text-muted-foreground">
              {quota.unlimited
                ? "Unlimited renders"
                : `${Math.max(0, quota.daily_limit - quota.daily_used)} videos left today`}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

function ReviewSummary({
  values,
  onEdit,
}: {
  values: WizardInput;
  onEdit: (step: number) => void;
}) {
  const voice = VOICES.find((v) => v.id === values.voice)?.label ?? values.voice;
  const duration =
    DURATIONS.find((d) => d.words === values.max_words)?.label ??
    `${values.max_words} words`;

  const groups: { title: string; step: number; rows: [string, React.ReactNode][] }[] = [
    {
      title: "Content",
      step: 0,
      rows: [
        ["Title", values.title],
        ["Subreddit", values.subreddit || "—"],
        ["Length cap", duration],
        [
          "Story",
          `${wordCountOf(values.story)} words · "${truncate(values.story, 80)}"`,
        ],
      ],
    },
    {
      title: "Voice",
      step: 1,
      rows: [
        ["Engine", TTS_PROVIDERS.find((p) => p.id === values.tts_provider)?.label ?? values.tts_provider],
        ["Voice", voice],
        ["Speed", `${values.speed.toFixed(2)}×`],
        ["Expressiveness", capitalize(values.expressiveness)],
      ],
    },
    {
      title: "Look & background",
      step: 2,
      rows: [
        ["Captions", values.captions_enabled ? `On · ${values.caption_font_size}px · ${values.caption_color} · ${values.caption_position}` : "Off"],
        ["Title card", values.title_enabled ? `On · ${values.title_position} · ${values.title_scale}%` : "Off"],
        ["Background", values.gameplay_source === "user" ? "My footage" : `Library · ${values.gameplay_category}`],
        ["File retention", values.retention === "retain" ? "Keep until deleted" : "Auto-delete ~15 min"],
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg font-semibold tracking-tight">{g.title}</h2>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onEdit(g.step)}>
              Edit
            </Button>
          </div>
          <dl className="overflow-hidden rounded-lg border">
            {g.rows.map(([k, v], i) => (
              <div
                key={k}
                className={`grid grid-cols-[130px_minmax(0,1fr)] gap-3 px-4 py-2.5 text-sm ${i > 0 ? "border-t" : ""}`}
              >
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function UserBackgroundPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <UserBackgroundPanel value={value || undefined} onChange={onChange} />
      <FieldError msg={error} />
    </div>
  );
}

const truncate = (t: string, n: number) =>
  t.length > n ? `${t.slice(0, n)}…` : t || "";
const wordCountOf = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

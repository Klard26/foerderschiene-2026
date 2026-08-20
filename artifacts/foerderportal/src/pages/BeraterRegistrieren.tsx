import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { CheckCircle2, ChevronRight, Loader2, Sparkles, AlertCircle } from "lucide-react";

import { useGetMyProviderProfile, getGetMyProviderProfileQueryKey, useCreateProvider, useGenerateBeraterProfiltext } from "@workspace/api-client-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";

const DENA_CATEGORIES = [
  { value: "wg", label: "Wohngebäude" },
  { value: "nwg", label: "Nichtwohngebäude" },
  { value: "ap", label: "Anlagen/Prozesse" },
  { value: "kfn", label: "Klimafreundlicher Neubau" },
  { value: "denkmal", label: "Denkmal" }
];

const DENA_PROGRAMS = [
  { value: "bafa-ebw", label: "BAFA Energieberatung Wohngebäude" },
  { value: "bafa-ebn", label: "BAFA Energieberatung Nichtwohngebäude" },
  { value: "beg-wg", label: "BEG Wohngebäude" },
  { value: "beg-nwg", label: "BEG Nichtwohngebäude" },
  { value: "beg-em", label: "BEG Einzelmaßnahmen" },
  { value: "kfw-kfn", label: "KfW Klimafreundlicher Neubau" },
  { value: "kfw-kfg", label: "KfW Klimafreundliche Gewerbegebäude" },
  { value: "dgnb-qng", label: "DGNB / QNG" }
];

const formSchema = z.object({
  displayName: z.string().min(2, "Bitte geben Sie Ihren vollständigen Namen ein."),
  companyLegalName: z.string().optional(),
  address: z.string().optional(),
  zip: z.string().min(5, "PLZ muss 5 Zeichen haben.").max(5, "PLZ darf maximal 5 Zeichen haben."),
  city: z.string().min(2, "Bitte geben Sie einen Ort ein."),
  phone: z.string().optional(),
  website: z.string().optional(),
  yearsExperience: z.coerce.number().min(0, "Die Erfahrung darf nicht negativ sein.").optional().or(z.literal("")),
  bafaNummer: z.string().optional(),
  consultationMode: z.enum(["online", "in-person", "both"], { required_error: "Bitte wählen Sie einen Beratungsmodus." }),

  dena_id: z.string().min(2, "Die dena-Kundennummer ist erforderlich."),
  dena_since: z
    .coerce.number()
    .int("Bitte ein gültiges Jahr angeben")
    .min(1950, "Jahr muss 1950 oder später sein")
    .max(new Date().getFullYear(), "Jahr darf nicht in der Zukunft liegen")
    .optional()
    .or(z.literal("")),
  dena_categories: z.array(z.string()).optional(),
  dena_programs: z.array(z.string()).optional(),
  certificates: z.string().optional(),

  kapazitaetStundenProWoche: z.coerce.number().min(1, "Mindestens 1 Stunde").max(80, "Maximal 80 Stunden").optional().or(z.literal("")),
  responseTime: z.string().optional(),

  bio: z.string().optional(),
});

const steps = [
  { id: 1, title: "Basisdaten", fields: ["displayName", "city", "zip", "consultationMode"] },
  { id: 2, title: "Qualifikation", fields: ["dena_id"] },
  { id: 3, title: "Kapazität", fields: [] },
  { id: 4, title: "Profiltext", fields: [] },
  { id: 5, title: "Übersicht", fields: [] }
];

export default function BeraterRegistrieren() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [localSuccess, setLocalSuccess] = useState(false);
  
  const { data: profile, isLoading: isProfileLoading, error: profileError } = useGetMyProviderProfile({
    query: { retry: false, queryKey: getGetMyProviderProfileQueryKey() }
  });
  
  const createProvider = useCreateProvider();
  const generateBio = useGenerateBeraterProfiltext();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: "",
      companyLegalName: "",
      address: "",
      zip: "",
      city: "",
      phone: "",
      website: "",
      yearsExperience: "" as any,
      bafaNummer: "",
      consultationMode: undefined,
      dena_id: "",
      dena_since: "" as any,
      dena_categories: [],
      dena_programs: [],
      certificates: "",
      kapazitaetStundenProWoche: "" as any,
      responseTime: "",
      bio: "",
    }
  });

  const nextStep = async () => {
    const fieldsToValidate = steps[currentStep - 1].fields;
    const isValid = await form.trigger(fieldsToValidate as any);
    if (isValid) {
      setCurrentStep(s => Math.min(steps.length, s + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createProvider.mutate({
      data: {
        category: "energieberatung",
        displayName: data.displayName,
        city: data.city,
        zip: data.zip,
        bio: data.bio || "",
        address: data.address,
        phone: data.phone,
        website: data.website,
        yearsExperience: typeof data.yearsExperience === "number" ? data.yearsExperience : undefined,
        companyLegalName: data.companyLegalName,
        responseTime: data.responseTime,
        consultationMode: data.consultationMode,
        certificates: data.certificates ? data.certificates.split(",").map(s => s.trim()).filter(Boolean) : [],
        bafaNummer: data.bafaNummer,
        kapazitaetStundenProWoche: typeof data.kapazitaetStundenProWoche === "number" ? data.kapazitaetStundenProWoche : undefined,
        qualifications: {
          dena_id: data.dena_id,
          dena_since: typeof data.dena_since === "number" ? String(data.dena_since) : undefined,
          dena_categories: data.dena_categories || [],
          dena_programs: data.dena_programs || []
        }
      }
    }, {
      onSuccess: () => {
        setLocalSuccess(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
      onError: (err: any) => {
        if (err.status === 409) {
          toast({ title: "Profil existiert bereits", description: "Sie haben bereits ein Beraterprofil registriert.", variant: "destructive" });
        } else if (err.status === 403) {
          toast({ title: "Kundenkonto erkannt", description: "Sie sind als Endkunde registriert. Bitte nutzen Sie eine andere E-Mail-Adresse für Ihr Beraterkonto.", variant: "destructive" });
        } else {
          toast({ title: "Ein Fehler ist aufgetreten", description: "Bitte versuchen Sie es später erneut.", variant: "destructive" });
        }
      }
    });
  };

  const handleGenerateAI = () => {
    const data = form.getValues();
    if (!data.displayName || !data.city) {
      toast({ title: "Fehlende Angaben", description: "Bitte füllen Sie Vorname, Nachname und Ort auf der ersten Seite aus, damit die KI einen passenden Text generieren kann.", variant: "destructive" });
      setCurrentStep(1);
      return;
    }
    
    generateBio.mutate({
      data: {
        displayName: data.displayName,
        city: data.city,
        yearsExperience: typeof data.yearsExperience === "number" ? data.yearsExperience : undefined,
        consultationMode: data.consultationMode,
        certificates: data.certificates ? data.certificates.split(",").map(s => s.trim()).filter(Boolean) : [],
      }
    }, {
      onSuccess: (res) => {
        form.setValue("bio", res.bio, { shouldValidate: true });
        toast({ title: "Erfolgreich generiert", description: "Der Profiltext wurde erstellt. Sie können ihn nun anpassen." });
      },
      onError: () => {
        toast({ title: "Generierung fehlgeschlagen", description: "Profiltext konnte nicht generiert werden.", variant: "destructive" });
      }
    });
  };

  const isCustomerError = profileError && (profileError as any).status === 403;

  if (isProfileLoading) {
    return (
      <div className="min-h-[100dvh] flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center bg-[var(--klard-bg)]">
          <Loader2 className="h-10 w-10 animate-spin text-[var(--klard-teal)]" />
        </main>
        <Footer />
      </div>
    );
  }

  if (profile || localSuccess) {
    const status = profile?.approvalStatus || "pending";
    const reason = profile?.rejectionReason;
    
    return (
      <div className="min-h-[100dvh] flex flex-col">
        <Navbar />
        <main className="flex-1 bg-[var(--klard-bg)] py-16 px-4">
          <div className="max-w-2xl mx-auto bg-white p-8 md:p-12 rounded-[2rem] shadow-sm border border-border text-center animate-in fade-in zoom-in-95 duration-500">
            {status === "pending" && (
              <>
                <div className="w-20 h-20 bg-[var(--klard-teal-p)] text-[var(--klard-teal-d)] rounded-full flex items-center justify-center mx-auto mb-8 border border-[var(--klard-teal-l)]">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h1 className="text-3xl font-serif font-bold text-foreground mb-4">Profil in Prüfung</h1>
                <p className="text-muted-foreground mb-8 text-lg max-w-lg mx-auto">
                  Vielen Dank für Ihre Registrierung! Wir prüfen Ihre Angaben und schalten Ihr Profil in Kürze frei. Ihre 2 kostenlosen Leads sind bereits für Sie reserviert.
                </p>
              </>
            )}
            {status === "approved" && (
              <>
                <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8 border border-green-100">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h1 className="text-3xl font-serif font-bold text-foreground mb-4">Profil genehmigt</h1>
                <p className="text-muted-foreground mb-8 text-lg max-w-lg mx-auto">
                  Willkommen bei Förderschiene. Ihr Beraterprofil ist online und Sie können ab sofort Anfragen aus Ihrer Region empfangen.
                </p>
              </>
            )}
            {status === "rejected" && (
              <>
                <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-8 border border-red-100">
                  <AlertCircle className="w-10 h-10" />
                </div>
                <h1 className="text-3xl font-serif font-bold text-foreground mb-4">Profil abgelehnt</h1>
                <p className="text-muted-foreground mb-8 text-lg max-w-lg mx-auto">
                  Leider konnten wir Ihr Profil nicht freischalten. <br/><br/>
                  Grund: <span className="font-medium text-foreground">{reason || "Unbekannt"}</span>
                </p>
              </>
            )}
            <Button asChild size="lg" className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white rounded-full px-8 h-12 hover-elevate">
              <Link href="/konto">Zum Konto wechseln</Link>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (isCustomerError) {
    return (
      <div className="min-h-[100dvh] flex flex-col">
        <Navbar />
        <main className="flex-1 bg-[var(--klard-bg)] py-16 px-4">
          <div className="max-w-2xl mx-auto bg-white p-8 md:p-12 rounded-[2rem] shadow-sm border border-border text-center">
            <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-8 border border-red-100">
              <AlertCircle className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-serif font-bold text-foreground mb-4">Kundenkonto erkannt</h1>
            <p className="text-muted-foreground mb-8 text-lg max-w-lg mx-auto">
              Sie sind aktuell mit einem Endkunden-Account eingeloggt. Um sich als Energieberater zu registrieren, benötigen Sie einen separaten Account mit einer anderen E-Mail-Adresse.
            </p>
            <Button asChild size="lg" className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white rounded-full px-8 h-12 hover-elevate">
              <Link href="/">Zurück zur Startseite</Link>
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <Navbar />
      <main className="flex-1 bg-[var(--klard-bg)] py-12 px-4 sm:px-8">
        <div className="max-w-3xl mx-auto">
          
          <div className="mb-10 animate-in fade-in slide-in-from-top-4 duration-500">
            <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground mb-8">Beraterprofil erstellen</h1>
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm font-medium">
              {steps.map((step, idx) => (
                <div key={step.id} className="flex items-center gap-3 sm:gap-4">
                  <span className={`flex items-center justify-center w-8 h-8 rounded-full text-xs transition-colors duration-300 ${currentStep === step.id ? 'bg-[var(--klard-teal)] text-white shadow-md' : currentStep > step.id ? 'bg-[var(--klard-teal-p)] text-[var(--klard-teal)] border border-[var(--klard-teal-l)]' : 'bg-muted text-muted-foreground'}`}>
                    {currentStep > step.id ? <CheckCircle2 className="w-4 h-4" /> : step.id}
                  </span>
                  <span className={`${currentStep === step.id ? 'text-foreground' : 'text-muted-foreground'} hidden sm:inline`}>
                    {step.title}
                  </span>
                  {idx < steps.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground/30 mx-1" />}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 sm:p-10 rounded-[2rem] shadow-sm border border-border/80">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                
                {/* STEP 1 */}
                {currentStep === 1 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="border-b pb-4 mb-6">
                      <h2 className="text-2xl font-serif font-bold">Basisdaten</h2>
                      <p className="text-muted-foreground mt-1 text-sm">Die wichtigsten Kontaktinformationen für Ihr Profil.</p>
                    </div>
                    
                    <div className="grid sm:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="displayName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Vor- und Nachname *</FormLabel>
                            <FormControl>
                              <Input placeholder="Max Mustermann" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="companyLegalName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Firmenname (optional)</FormLabel>
                            <FormControl>
                              <Input placeholder="Muster Energieberatung GmbH" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Straße & Hausnummer (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Musterstraße 1" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-3 gap-6">
                      <div className="col-span-1">
                        <FormField
                          control={form.control}
                          name="zip"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>PLZ *</FormLabel>
                              <FormControl>
                                <Input maxLength={5} placeholder="10115" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-2">
                        <FormField
                          control={form.control}
                          name="city"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Ort *</FormLabel>
                              <FormControl>
                                <Input placeholder="Berlin" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Telefon (optional)</FormLabel>
                            <FormControl>
                              <Input type="tel" placeholder="030 1234567" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="website"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Website (optional)</FormLabel>
                            <FormControl>
                              <Input type="url" placeholder="https://" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="yearsExperience"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Berufserfahrung in Jahren (optional)</FormLabel>
                            <FormControl>
                              <Input type="number" min={0} placeholder="z.B. 5" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="bafaNummer"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>BAFA-Beraternummer (optional)</FormLabel>
                            <FormControl>
                              <Input placeholder="z.B. 123456" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="consultationMode"
                      render={({ field }) => (
                        <FormItem className="pt-2">
                          <FormLabel className="text-base">Beratungsmodus *</FormLabel>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              className="flex flex-col sm:flex-row gap-4 mt-3"
                            >
                              <div className={`flex items-center space-x-2 border p-4 rounded-xl flex-1 cursor-pointer transition-colors ${field.value === 'in-person' ? 'bg-[var(--klard-teal-p)] border-[var(--klard-teal)]' : 'hover:bg-muted/30'}`}>
                                <RadioGroupItem value="in-person" id="mode-in-person" />
                                <Label htmlFor="mode-in-person" className="cursor-pointer font-medium">Nur Vor-Ort</Label>
                              </div>
                              <div className={`flex items-center space-x-2 border p-4 rounded-xl flex-1 cursor-pointer transition-colors ${field.value === 'online' ? 'bg-[var(--klard-teal-p)] border-[var(--klard-teal)]' : 'hover:bg-muted/30'}`}>
                                <RadioGroupItem value="online" id="mode-online" />
                                <Label htmlFor="mode-online" className="cursor-pointer font-medium">Nur Online / Video</Label>
                              </div>
                              <div className={`flex items-center space-x-2 border p-4 rounded-xl flex-1 cursor-pointer transition-colors ${field.value === 'both' ? 'bg-[var(--klard-teal-p)] border-[var(--klard-teal)]' : 'hover:bg-muted/30'}`}>
                                <RadioGroupItem value="both" id="mode-both" />
                                <Label htmlFor="mode-both" className="cursor-pointer font-medium">Beides</Label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* STEP 2 */}
                {currentStep === 2 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="border-b pb-4 mb-6">
                      <h2 className="text-2xl font-serif font-bold">Qualifikation & Listung</h2>
                      <p className="text-muted-foreground mt-1 text-sm">Bitte geben Sie Ihre Zertifizierungen an.</p>
                    </div>
                    
                    <div className="grid sm:grid-cols-2 gap-6 bg-muted/10 p-6 rounded-2xl border">
                      <FormField
                        control={form.control}
                        name="dena_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>dena-Kundennummer *</FormLabel>
                            <FormControl>
                              <Input placeholder="z.B. 123456" {...field} className="bg-white" />
                            </FormControl>
                            <FormDescription>Wir gleichen diese mit der Expertenliste ab.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="dena_since"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Gelistet seit (Jahr, optional)</FormLabel>
                            <FormControl>
                              <Input type="number" min={1990} max={new Date().getFullYear()} placeholder="z.B. 2018" {...field} className="bg-white" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="dena_categories"
                      render={() => (
                        <FormItem>
                          <FormLabel className="text-base">dena-Kategorien</FormLabel>
                          <div className="grid sm:grid-cols-2 gap-3 mt-3">
                            {DENA_CATEGORIES.map((cat) => (
                              <FormField
                                key={cat.value}
                                control={form.control}
                                name="dena_categories"
                                render={({ field }) => {
                                  return (
                                    <FormItem
                                      key={cat.value}
                                      className="flex flex-row items-center space-x-3 space-y-0 border p-3 rounded-lg hover:bg-muted/10 transition-colors"
                                    >
                                      <FormControl>
                                        <Checkbox
                                          checked={field.value?.includes(cat.value)}
                                          onCheckedChange={(checked) => {
                                            return checked
                                              ? field.onChange([...(field.value || []), cat.value])
                                              : field.onChange(
                                                  field.value?.filter((v) => v !== cat.value)
                                                )
                                          }}
                                        />
                                      </FormControl>
                                      <FormLabel className="font-normal cursor-pointer flex-1">
                                        {cat.label}
                                      </FormLabel>
                                    </FormItem>
                                  )
                                }}
                              />
                            ))}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="dena_programs"
                      render={() => (
                        <FormItem>
                          <FormLabel className="text-base">Förderprogramme (Zulassung)</FormLabel>
                          <div className="grid sm:grid-cols-2 gap-3 mt-3">
                            {DENA_PROGRAMS.map((prog) => (
                              <FormField
                                key={prog.value}
                                control={form.control}
                                name="dena_programs"
                                render={({ field }) => {
                                  return (
                                    <FormItem
                                      key={prog.value}
                                      className="flex flex-row items-center space-x-3 space-y-0 border p-3 rounded-lg hover:bg-muted/10 transition-colors"
                                    >
                                      <FormControl>
                                        <Checkbox
                                          checked={field.value?.includes(prog.value)}
                                          onCheckedChange={(checked) => {
                                            return checked
                                              ? field.onChange([...(field.value || []), prog.value])
                                              : field.onChange(
                                                  field.value?.filter((v) => v !== prog.value)
                                                )
                                          }}
                                        />
                                      </FormControl>
                                      <FormLabel className="font-normal cursor-pointer flex-1">
                                        {prog.label}
                                      </FormLabel>
                                    </FormItem>
                                  )
                                }}
                              />
                            ))}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="certificates"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Weitere Zertifikate & Spezialisierungen (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="z.B. TÜV, Passivhaus, DGNB (kommagetrennt)" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* STEP 3 */}
                {currentStep === 3 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="border-b pb-4 mb-6">
                      <h2 className="text-2xl font-serif font-bold">Verfügbarkeit & Kapazität</h2>
                      <p className="text-muted-foreground mt-1 text-sm">Wie viele Ressourcen haben Sie für neue Kunden frei?</p>
                    </div>
                    
                    <div className="space-y-8 bg-muted/10 p-6 sm:p-8 rounded-2xl border">
                      <FormField
                        control={form.control}
                        name="kapazitaetStundenProWoche"
                        render={({ field }) => (
                          <FormItem className="max-w-md">
                            <FormLabel className="text-base">Wie viele Stunden pro Woche können Sie für Förderschiene-Kunden aufwenden?</FormLabel>
                            <div className="flex items-center gap-3 mt-3">
                              <FormControl>
                                <Input type="number" min={1} max={80} className="w-24 bg-white" {...field} />
                              </FormControl>
                              <span className="text-muted-foreground text-sm font-medium">Stunden / Woche</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="responseTime"
                        render={({ field }) => (
                          <FormItem className="max-w-md">
                            <FormLabel className="text-base">Übliche Reaktionszeit auf Anfragen</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger className="bg-white mt-3">
                                  <SelectValue placeholder="Bitte wählen..." />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Innerhalb 24 Stunden">Innerhalb 24 Stunden</SelectItem>
                                <SelectItem value="Innerhalb 48 Stunden">Innerhalb 48 Stunden</SelectItem>
                                <SelectItem value="Innerhalb einer Woche">Innerhalb einer Woche</SelectItem>
                                <SelectItem value="Länger als eine Woche">Länger als eine Woche</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* STEP 4 */}
                {currentStep === 4 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="border-b pb-4 mb-6">
                      <h2 className="text-2xl font-serif font-bold">Ihr Profiltext</h2>
                      <p className="text-muted-foreground mt-1 text-sm">Stellen Sie sich Ihren zukünftigen Kunden vor.</p>
                    </div>

                    <div className="bg-[var(--klard-teal-p)]/40 p-5 rounded-xl border border-[var(--klard-teal-l)]/50 mb-6 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-[var(--klard-teal-p)] flex items-center justify-center shrink-0">
                        <Sparkles className="w-5 h-5 text-[var(--klard-teal-d)]" />
                      </div>
                      <div>
                        <h4 className="font-bold text-[var(--klard-ink)] mb-1">KI-Assistenz</h4>
                        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                          Keine Lust, einen Text von Grund auf neu zu schreiben? Unsere KI erstellt Ihnen anhand Ihrer bisherigen Angaben einen professionellen Entwurf in Sekundenschnelle.
                        </p>
                        <Button 
                          type="button" 
                          variant="outline" 
                          size="sm" 
                          onClick={handleGenerateAI}
                          disabled={generateBio.isPending}
                          className="bg-white text-[var(--klard-teal-d)] hover:text-[var(--klard-teal)] hover:border-[var(--klard-teal-l)]"
                        >
                          {generateBio.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                          Text automatisch generieren
                        </Button>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="bio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Über mich</FormLabel>
                          <FormControl>
                            <Textarea 
                              rows={10} 
                              className="resize-none text-base leading-relaxed p-4"
                              placeholder="Guten Tag, mein Name ist... Ich bin zertifizierter Energieberater und unterstütze Sie gerne bei Ihrem Vorhaben."
                              {...field} 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* STEP 5 */}
                {currentStep === 5 && (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="border-b pb-4 mb-6">
                      <h2 className="text-2xl font-serif font-bold">Übersicht & Abschluss</h2>
                      <p className="text-muted-foreground mt-1 text-sm">Bitte prüfen Sie Ihre Angaben vor dem Absenden.</p>
                    </div>
                    
                    <div className="bg-muted/10 p-6 rounded-2xl border space-y-5 text-sm">
                      <div className="grid grid-cols-3 border-b pb-4">
                        <span className="text-muted-foreground font-medium">Name</span>
                        <span className="col-span-2 text-foreground font-semibold">{form.watch("displayName")}</span>
                      </div>
                      <div className="grid grid-cols-3 border-b pb-4">
                        <span className="text-muted-foreground font-medium">Standort</span>
                        <span className="col-span-2 text-foreground font-semibold">{form.watch("zip")} {form.watch("city")}</span>
                      </div>
                      <div className="grid grid-cols-3 border-b pb-4">
                        <span className="text-muted-foreground font-medium">dena-Nummer</span>
                        <span className="col-span-2 text-foreground font-semibold">{form.watch("dena_id")}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-muted-foreground font-medium">Beratungsmodus</span>
                        <span className="col-span-2 text-foreground font-semibold flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-[var(--klard-teal)]" />
                          {form.watch("consultationMode") === "online" && "Nur Online / Video"}
                          {form.watch("consultationMode") === "in-person" && "Nur Vor-Ort"}
                          {form.watch("consultationMode") === "both" && "Online & Vor-Ort"}
                        </span>
                      </div>
                    </div>

                    <div className="bg-blue-50/50 border border-blue-100 p-5 rounded-xl flex items-start gap-4">
                      <div className="mt-0.5">
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                      </div>
                      <p className="text-sm text-blue-900 leading-relaxed">
                        Mit Klick auf "Profil einreichen" stimmen Sie den <a href={`${import.meta.env.BASE_URL}agb/`} className="underline font-semibold" target="_blank" rel="noopener noreferrer">AGB</a> für Berater zu. 
                        Ihr Profil wird nach der Einreichung durch unser Team manuell geprüft und freigeschaltet. 
                        <strong className="block mt-1">Die ersten zwei vermittelten Kundenanfragen sind kostenlos.</strong>
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center mt-12 pt-8 border-t">
                  <Button 
                    type="button"
                    variant="outline" 
                    size="lg"
                    onClick={() => {
                      setCurrentStep(s => Math.max(1, s - 1));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    disabled={currentStep === 1 || createProvider.isPending}
                    className={`rounded-full px-6 hover-elevate transition-opacity ${currentStep === 1 ? 'opacity-0 pointer-events-none' : ''}`}
                  >
                    Zurück
                  </Button>

                  {currentStep < steps.length ? (
                    <Button 
                      type="button"
                      size="lg"
                      onClick={nextStep}
                      className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white rounded-full px-8 hover-elevate shadow-md"
                    >
                      Weiter <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  ) : (
                    <Button 
                      type="submit"
                      size="lg"
                      disabled={createProvider.isPending}
                      className="bg-[var(--klard-teal)] hover:bg-[var(--klard-teal-d)] text-white rounded-full px-8 hover-elevate shadow-md"
                    >
                      {createProvider.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Profil verbindlich einreichen
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
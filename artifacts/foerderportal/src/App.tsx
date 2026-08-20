import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useAuth, useClerk } from '@clerk/react';
import { deDE } from '@clerk/localizations';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Landing from "./pages/Landing";
import BeraterLanding from "./pages/BeraterLanding";
import BeraterRegistrieren from "./pages/BeraterRegistrieren";
import Gebaeudecheck from "./pages/Gebaeudecheck";
import ReportPage from "./pages/ReportPage";
import EnergieausweisPage from "./pages/EnergieausweisPage";
import FoerderpilotFinder from "./pages/FoerderpilotFinder";
import FoerderpilotDetail from "./pages/FoerderpilotDetail";
import FoerderpilotSchnellcheck from "./pages/FoerderpilotSchnellcheck";
import FoerderFinderWizard from "./pages/FoerderFinderWizard";
import Verwaltung from "./pages/Verwaltung";
import Konto from "./pages/Konto";
import Portfolio from "./pages/Portfolio";
import Kunden from "./pages/Kunden";
import EnergieausweisStatusPage from "./pages/EnergieausweisStatusPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/favicon.svg`,
  },
  variables: {
    colorPrimary: "hsl(216 53% 16%)",
    colorForeground: "hsl(216 53% 16%)",
    colorMutedForeground: "hsl(30 10% 42%)",
    colorDanger: "hsl(0 70% 50%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(38 22% 86%)",
    colorInputForeground: "hsl(216 53% 16%)",
    colorNeutral: "hsl(38 22% 86%)",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-bold",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary font-medium hover:text-primary/80",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground bg-white px-2",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-green-600",
    alertText: "text-destructive",
    logoBox: "flex justify-center",
    logoImage: "h-8 w-auto",
    socialButtonsBlockButton: "border border-input hover:bg-muted/50",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium",
    formFieldInput: "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    footerAction: "mt-4 border-t pt-4 border-border",
    dividerLine: "bg-border h-[1px]",
    alert: "bg-destructive/10 border border-destructive/20 rounded-md p-3",
    otpCodeFieldInput: "border-input",
    formFieldRow: "space-y-2",
    main: "p-6",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AuthRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function BeraterRegistrationRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  const registrationPath = `${basePath}/berater/registrieren`;

  if (!isLoaded) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--klard-bg)] px-4">
        <p className="text-sm font-medium text-muted-foreground">Anmeldung wird geladen …</p>
      </main>
    );
  }

  if (isSignedIn) {
    return <BeraterRegistrieren />;
  }

  return <Redirect to={`/sign-up?redirect_url=${encodeURIComponent(registrationPath)}`} />;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={deDE}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/check" component={Gebaeudecheck} />
          <Route path="/schnellcheck" component={FoerderpilotSchnellcheck} />
          <Route path="/foerderprogramme-finden" component={FoerderFinderWizard} />
          <Route path="/foerderung" component={FoerderpilotFinder} />
          <Route path="/foerderung/:id" component={FoerderpilotDetail} />
          <Route path="/report" component={ReportPage} />
          <Route path="/energieausweis">
            {() => <AuthRoute component={EnergieausweisPage} />}
          </Route>
          <Route path="/energieausweis/status">
            {() => <AuthRoute component={EnergieausweisStatusPage} />}
          </Route>
          <Route path="/konto">
            {() => <AuthRoute component={Konto} />}
          </Route>
          <Route path="/portfolio">
            {() => <AuthRoute component={Portfolio} />}
          </Route>
          <Route path="/kunden">
            {() => <AuthRoute component={Kunden} />}
          </Route>
          <Route path="/verwaltung">
            {() => <AuthRoute component={Verwaltung} />}
          </Route>
          <Route path="/berater" component={BeraterLanding} />
          <Route path="/berater/registrieren" component={BeraterRegistrationRoute} />
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <TooltipProvider>
        <ClerkProviderWithRoutes />
        <Toaster />
      </TooltipProvider>
    </WouterRouter>
  );
}

export default App;

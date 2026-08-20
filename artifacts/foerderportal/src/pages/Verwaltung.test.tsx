import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { vorgangApi } from "@/lib/vorgangApi";
import { RefundedOrdersPanel, VorgaengePanel } from "./Verwaltung";
import type { ReactNode } from "react";

vi.mock("@clerk/react", () => ({
  useAuth: vi.fn(),
  useUser: vi.fn(() => ({ isLoaded: true })),
}));

vi.mock("@/lib/vorgangApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vorgangApi")>()),
  vorgangApi: {
    list: vi.fn(),
  },
}));

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("Verwaltung data panels", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      getToken: vi.fn().mockResolvedValue("test-token"),
    } as unknown as ReturnType<typeof useAuth>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("VorgaengePanel", () => {
    it("shows a meaningful empty state when there are no Vorgänge", async () => {
      vi.mocked(vorgangApi.list).mockResolvedValueOnce({ anzahl: 0, vorgaenge: [] });

      renderWithQueryClient(<VorgaengePanel onOpen={vi.fn()} />);

      expect(await screen.findByTestId("vorgaenge-empty")).toHaveTextContent(
        "Keine Vorgänge"
      );
    });

    it("shows a retryable error state when loading Vorgänge fails", async () => {
      vi.mocked(vorgangApi.list).mockRejectedValueOnce(new Error("permission denied"));

      renderWithQueryClient(<VorgaengePanel onOpen={vi.fn()} />);

      expect(await screen.findByTestId("vorgaenge-error")).toHaveTextContent(
        "Vorgänge konnten nicht geladen werden."
      );

      vi.mocked(vorgangApi.list).mockResolvedValueOnce({ anzahl: 0, vorgaenge: [] });
      await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));

      await waitFor(() => expect(vorgangApi.list).toHaveBeenCalledTimes(2));
      expect(await screen.findByTestId("vorgaenge-empty")).toBeInTheDocument();
    });
  });

  describe("RefundedOrdersPanel", () => {
    it("shows a meaningful empty state when there are no refunded orders", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

      renderWithQueryClient(<RefundedOrdersPanel />);

      expect(await screen.findByTestId("refunded-orders-empty")).toHaveTextContent(
        "Noch keine erstatteten Bestellungen."
      );
    });

    it("shows an error state when loading refunded orders fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

      renderWithQueryClient(<RefundedOrdersPanel />);

      expect(
        await screen.findByText("Die Rückerstattungen konnten nicht geladen werden.")
      ).toBeInTheDocument();
    });

    it("shows credit details for refunded Gebäudecheck packages", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: "geb-check-1",
            product: "Gebäudecheck-Guthaben",
            buyerEmail: null,
            status: "refunded",
            amountCents: 4900,
            credits: 5,
            creditsDeducted: 3,
            creditsAlreadyUsed: 2,
            createdAt: "2026-08-19T10:00:00.000Z",
            refundedAt: "2026-08-19T11:00:00.000Z",
          },
          {
            id: "report-1",
            product: "Gebäudereport",
            buyerEmail: "buyer@example.com",
            status: "refunded",
            amountCents: 9900,
            createdAt: "2026-08-19T09:00:00.000Z",
            refundedAt: "2026-08-19T09:30:00.000Z",
          },
        ],
      }));

      renderWithQueryClient(<RefundedOrdersPanel />);

      expect(await screen.findByTestId("refunded-credits-geb-check-1")).toHaveTextContent("5");
      expect(screen.getByTestId("refunded-credits-reclaimed-geb-check-1")).toHaveTextContent("3");
      expect(screen.getByTestId("refunded-credits-used-geb-check-1")).toHaveTextContent("2");
      expect(screen.getByTestId("refunded-credits-report-1")).toHaveTextContent("—");
      expect(screen.getByTestId("refunded-credits-reclaimed-report-1")).toHaveTextContent("—");
      expect(screen.getByTestId("refunded-credits-used-report-1")).toHaveTextContent("—");
    });
  });
});
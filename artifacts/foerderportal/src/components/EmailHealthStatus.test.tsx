import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmailHealthStatus } from "./EmailHealthStatus";
import type { useEmailDeliveryHealth } from "@/lib/vorgangApi";

// ---------------------------------------------------------------------------
// Helper: build a minimal UseQueryResult-shaped object for the health prop.
// ---------------------------------------------------------------------------
type HealthProp = ReturnType<typeof useEmailDeliveryHealth>;

function makeHealth(overrides: Partial<HealthProp>): HealthProp {
  return {
    isLoading: false,
    isFetching: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as HealthProp;
}

const HEALTHY_DATA = {
  healthy: true,
  windowHours: 24,
  monitoredTemplateIds: ["tpl_welcome"],
  failedCount: 0,
  failures: [],
};

const FAILURE_DATA = {
  healthy: false,
  windowHours: 24,
  monitoredTemplateIds: ["tpl_welcome"],
  failedCount: 3,
  failures: [
    {
      id: 1,
      templateId: "tpl_welcome",
      recipient: "buyer@example.com",
      error: "SMTP connection refused",
      sentAt: "2026-08-19T08:00:00Z",
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmailHealthStatus", () => {
  it("renders a skeleton loading card while the query is pending", () => {
    render(<EmailHealthStatus health={makeHealth({ isLoading: true })} />);
    expect(screen.getByTestId("email-health-loading")).toBeInTheDocument();
  });

  describe("healthy state", () => {
    it("renders the green delivery indicator", () => {
      render(<EmailHealthStatus health={makeHealth({ data: HEALTHY_DATA })} />);
      const card = screen.getByTestId("email-health-healthy");
      expect(card).toBeInTheDocument();
    });

    it("shows an OK badge", () => {
      render(<EmailHealthStatus health={makeHealth({ data: HEALTHY_DATA })} />);
      expect(screen.getByText("OK")).toBeInTheDocument();
    });

    it("mentions the monitoring window in hours", () => {
      render(<EmailHealthStatus health={makeHealth({ data: HEALTHY_DATA })} />);
      expect(screen.getByText(/24 Stunden/)).toBeInTheDocument();
    });
  });

  describe("failure state", () => {
    it("renders the failure count", () => {
      render(<EmailHealthStatus health={makeHealth({ data: FAILURE_DATA })} />);
      const card = screen.getByTestId("email-health-failures");
      expect(card).toBeInTheDocument();
      expect(screen.getByText(/3 fehlgeschlagene/i)).toBeInTheDocument();
    });

    it("renders the most recent error text", () => {
      render(<EmailHealthStatus health={makeHealth({ data: FAILURE_DATA })} />);
      expect(screen.getByText(/SMTP connection refused/)).toBeInTheDocument();
    });

    it("renders a refresh button", () => {
      render(<EmailHealthStatus health={makeHealth({ data: FAILURE_DATA })} />);
      expect(screen.getByTestId("button-refresh-email-health")).toBeInTheDocument();
    });

    it("calls refetch when the refresh button is clicked", async () => {
      const refetch = vi.fn();
      render(
        <EmailHealthStatus health={makeHealth({ data: FAILURE_DATA, refetch })} />
      );
      await userEvent.click(screen.getByTestId("button-refresh-email-health"));
      expect(refetch).toHaveBeenCalledOnce();
    });

    it("uses the plural form for multiple failures", () => {
      render(<EmailHealthStatus health={makeHealth({ data: FAILURE_DATA })} />);
      expect(screen.getByText(/E-Mails erkannt/i)).toBeInTheDocument();
    });

    it("uses the singular form when exactly one failure", () => {
      const singularData = { ...FAILURE_DATA, failedCount: 1 };
      render(<EmailHealthStatus health={makeHealth({ data: singularData })} />);
      expect(screen.getByText(/1 fehlgeschlagene E-Mail erkannt/i)).toBeInTheDocument();
    });
  });

  describe("unavailable (error) state", () => {
    it("renders the amber unavailable card when the query throws", () => {
      render(
        <EmailHealthStatus
          health={makeHealth({ isError: true, error: new Error("Network error") })}
        />
      );
      const card = screen.getByTestId("email-health-error");
      expect(card).toBeInTheDocument();
    });

    it("shows a retry button instead of a blank card", () => {
      render(
        <EmailHealthStatus
          health={makeHealth({ isError: true, error: new Error("Network error") })}
        />
      );
      expect(screen.getByTestId("button-refresh-email-health")).toBeInTheDocument();
    });

    it("calls refetch when the retry button is clicked", async () => {
      const refetch = vi.fn();
      render(
        <EmailHealthStatus
          health={makeHealth({ isError: true, error: new Error("Network error"), refetch })}
        />
      );
      await userEvent.click(screen.getByTestId("button-refresh-email-health"));
      expect(refetch).toHaveBeenCalledOnce();
    });

    it("renders the amber unavailable card when data is absent but not loading", () => {
      // isError=false, data=undefined — treated as unavailable
      render(<EmailHealthStatus health={makeHealth({ data: undefined })} />);
      expect(screen.getByTestId("email-health-error")).toBeInTheDocument();
    });
  });
});

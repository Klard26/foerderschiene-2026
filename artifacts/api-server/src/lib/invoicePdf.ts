import PDFDocument from "pdfkit";
import type { Invoice, Provider } from "@workspace/db";

export interface InvoicePdfInput {
  invoice: Invoice;
  provider: Provider;
}

function eur(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function fmtDate(d: Date | string): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(typeof d === "string" ? new Date(d) : d);
}

/**
 * Renders a § 14 UStG-konforme PDF-Rechnung as a Buffer using pdfkit.
 *
 * Required by § 14 Abs. 4 UStG:
 *  - Full name and address of supplier (provider) and recipient (customer)
 *  - Tax ID (USt-IdNr or Steuernummer)
 *  - Issue date
 *  - Sequential, unique invoice number
 *  - Quantity and type of goods/services
 *  - Date of supply (Leistungsdatum)
 *  - Net amount per tax rate, applied tax rate, tax amount
 *  - Note on reason for tax exemption (§ 19 UStG Kleinunternehmer)
 */
export async function renderInvoicePdf({ invoice, provider }: InvoicePdfInput): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      const isStorno = invoice.kind === "storno";
      const heading = isStorno ? "Stornorechnung" : "Rechnung";

      // Header — supplier block (top left)
      doc.fontSize(9).fillColor("#666");
      const supplierLines: string[] = [];
      supplierLines.push(provider.companyLegalName ?? provider.displayName);
      if (provider.address) supplierLines.push(provider.address);
      supplierLines.push(`${provider.zip} ${provider.city}`);
      doc.text(supplierLines.join(" · "), 50, 50, { width: 500 });

      // Title
      doc.fontSize(20).fillColor("#111").text(heading, 50, 95);

      // Recipient block (left)
      doc.fontSize(10).fillColor("#111");
      const recipientY = 145;
      doc.text("Rechnung an:", 50, recipientY);
      doc.font("Helvetica-Bold");
      doc.text(invoice.customerName ?? "Kunde", 50, recipientY + 14);
      doc.font("Helvetica");
      if (invoice.customerAddress) {
        doc.text(invoice.customerAddress, 50, recipientY + 28, { width: 240 });
      }
      if (invoice.customerEmail) {
        doc.text(invoice.customerEmail, 50, recipientY + 70);
      }

      // Meta block (right)
      const metaX = 340;
      let metaY = recipientY;
      const metaRow = (label: string, value: string) => {
        doc.fontSize(9).fillColor("#666").text(label, metaX, metaY, { width: 100 });
        doc.fontSize(10).fillColor("#111").text(value, metaX + 105, metaY, { width: 145 });
        metaY += 16;
      };
      metaRow("Rechnungsnummer:", invoice.invoiceNumber);
      metaRow("Rechnungsdatum:", fmtDate(invoice.issuedAt));
      if (invoice.serviceDate) metaRow("Leistungsdatum:", fmtDate(invoice.serviceDate));
      if (provider.taxId) metaRow("Steuernr./USt-IdNr.:", provider.taxId);
      if (isStorno && invoice.originalInvoiceId != null) {
        metaRow("Storno zu:", `Rechnung #${invoice.originalInvoiceId}`);
      }

      // Line items table
      const tableTop = 270;
      doc.fontSize(9).fillColor("#666");
      doc.text("Pos.", 50, tableTop);
      doc.text("Leistung", 90, tableTop);
      doc.text("Netto", 400, tableTop, { width: 60, align: "right" });
      doc.text("MwSt.", 460, tableTop, { width: 40, align: "right" });
      doc.text("Brutto", 500, tableTop, { width: 60, align: "right" });
      doc.moveTo(50, tableTop + 14).lineTo(560, tableTop + 14).strokeColor("#ddd").stroke();

      const lineY = tableTop + 22;
      doc.fontSize(10).fillColor("#111");
      doc.text("1", 50, lineY);
      doc.text(invoice.serviceName, 90, lineY, { width: 300 });
      if (invoice.serviceDescription) {
        doc.fontSize(8).fillColor("#666").text(invoice.serviceDescription, 90, lineY + 14, { width: 300 });
        doc.fontSize(10).fillColor("#111");
      }
      const sign = isStorno ? -1 : 1;
      doc.text(eur(sign * invoice.netCents), 400, lineY, { width: 60, align: "right" });
      doc.text(`${Number(invoice.taxRate).toFixed(0)} %`, 460, lineY, { width: 40, align: "right" });
      doc.text(eur(sign * invoice.totalCents), 500, lineY, { width: 60, align: "right" });

      // Totals
      const totalsY = lineY + 60;
      doc.moveTo(340, totalsY).lineTo(560, totalsY).strokeColor("#ddd").stroke();
      const tRow = (label: string, value: string, bold = false) => {
        if (bold) doc.font("Helvetica-Bold");
        else doc.font("Helvetica");
        doc.fontSize(10).fillColor("#111");
        doc.text(label, 340, totalsY + 8, { width: 160 });
        doc.text(value, 500, totalsY + 8, { width: 60, align: "right" });
        doc.font("Helvetica");
      };
      tRow("Nettobetrag", eur(sign * invoice.netCents));
      doc
        .fontSize(10)
        .text(`MwSt. ${Number(invoice.taxRate).toFixed(0)} %`, 340, totalsY + 26, { width: 160 })
        .text(eur(sign * invoice.taxCents), 500, totalsY + 26, { width: 60, align: "right" });
      doc.moveTo(340, totalsY + 48).lineTo(560, totalsY + 48).strokeColor("#999").stroke();
      doc.font("Helvetica-Bold").fontSize(12);
      doc.text(isStorno ? "Gesamtbetrag (Gutschrift)" : "Rechnungsbetrag", 340, totalsY + 56, { width: 160 });
      doc.text(eur(sign * invoice.totalCents), 500, totalsY + 56, { width: 60, align: "right" });
      doc.font("Helvetica");

      // Notes
      let notesY = totalsY + 100;
      doc.fontSize(9).fillColor("#444");
      if (provider.kleinunternehmer) {
        doc.text(
          "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).",
          50,
          notesY,
          { width: 510 },
        );
        notesY += 28;
      }
      if (isStorno) {
        doc.text(
          "Diese Stornorechnung hebt die ursprüngliche Rechnung vollständig auf.",
          50,
          notesY,
          { width: 510 },
        );
        notesY += 20;
      } else {
        doc.text(
          "Der Betrag wurde über die Klard-Plattform via Stripe bezahlt. Diese Rechnung dient ausschließlich der steuerlichen Dokumentation.",
          50,
          notesY,
          { width: 510 },
        );
        notesY += 28;
      }
      if (provider.invoiceFooter) {
        doc.fontSize(8).fillColor("#666");
        doc.text(provider.invoiceFooter, 50, notesY, { width: 510 });
      }

      // Footer — supplier contact
      const footerY = 770;
      doc.fontSize(8).fillColor("#888");
      const footer: string[] = [];
      footer.push(provider.companyLegalName ?? provider.displayName);
      if (provider.email) footer.push(provider.email);
      if (provider.iban) footer.push(`IBAN: ${provider.iban}`);
      if (provider.taxId) footer.push(`Steuernr.: ${provider.taxId}`);
      doc.text(footer.join("  ·  "), 50, footerY, { width: 510, align: "center" });

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

/**
 * SapFormCard.jsx
 * ─────────────────────────────────────────────────────────────
 * Add this component to your Lovable frontend.
 *
 * HOW TO USE IN YOUR CHAT COMPONENT:
 *  When the API response contains `formFields`, render this instead
 *  of (or alongside) the markdown reply.
 *
 *  Example in your chat message renderer:
 *
 *    if (message.formFields?.length > 0) {
 *      return (
 *        <SapFormCard
 *          title={message.formTitle}
 *          fields={message.formFields}
 *          collectingFor={message.collectingFor}
 *          onSubmit={(valuesMessage) => sendChatMessage(valuesMessage)}
 *        />
 *      );
 *    }
 *
 *  `sendChatMessage` = your existing function that sends a user message to /api/chat
 * ─────────────────────────────────────────────────────────────
 */

import React, { useState } from "react";

export default function SapFormCard({ title, fields = [], collectingFor, onSubmit }) {
  const [values, setValues]   = useState({});
  const [errors, setErrors]   = useState({});
  const [submitted, setSubmitted] = useState(false);

  // ── Handle input change ───────────────────────────────────────
  const handleChange = (key, value) => {
    setValues(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: null }));
  };

  // ── Validate required fields ──────────────────────────────────
  const validate = () => {
    const newErrors = {};
    fields.forEach(f => {
      if (f.required && (!values[f.key] || String(values[f.key]).trim() === "")) {
        newErrors[f.key] = `${f.label} is required`;
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ── Submit: format values as natural language message ─────────
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    // Build a structured message the AI can parse
    const parts = fields
      .filter(f => values[f.key] !== undefined && values[f.key] !== "")
      .map(f => `${f.label}=${values[f.key]}`);

    const message = `Create ${title || collectingFor}: ${parts.join(", ")}`;
    setSubmitted(true);
    onSubmit(message);
  };

  if (submitted) {
    return (
      <div style={styles.submitted}>
        ⏳ Processing your request...
      </div>
    );
  }

  const requiredCount = fields.filter(f => f.required).length;

  return (
    <div style={styles.card}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerIcon}>📋</span>
        <span style={styles.headerTitle}>{title || "Fill in Details"}</span>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div style={styles.fieldsGrid}>
          {fields.map((f, i) => (
            <div key={f.key} style={styles.fieldRow}>
              {/* Label */}
              <label style={styles.label}>
                {f.label}
                {f.required && <span style={styles.required}> *</span>}
              </label>

              {/* Description */}
              <div style={styles.description}>{f.description}</div>

              {/* Input */}
              <input
                type={f.type === "number" ? "number" : f.type === "date" ? "text" : "text"}
                placeholder={`e.g. ${f.example}`}
                value={values[f.key] || ""}
                onChange={e => handleChange(f.key, e.target.value)}
                style={{
                  ...styles.input,
                  ...(errors[f.key] ? styles.inputError : {})
                }}
              />

              {/* Error */}
              {errors[f.key] && (
                <div style={styles.errorMsg}>⚠️ {errors[f.key]}</div>
              )}

              {/* Example hint */}
              {!errors[f.key] && (
                <div style={styles.example}>Example: {f.example}</div>
              )}
            </div>
          ))}
        </div>

        {/* Validation summary */}
        {Object.keys(errors).length > 0 && (
          <div style={styles.validationBanner}>
            ⚠️ Please fill in all {Object.keys(errors).length} required field(s) before submitting.
          </div>
        )}

        {/* Submit */}
        <button type="submit" style={styles.submitBtn}>
          ✅ Create {title?.replace("Create ", "") || "Record"} in SAP
        </button>

        <div style={styles.hint}>
          * {requiredCount} required field{requiredCount !== 1 ? "s" : ""}
          {fields.length - requiredCount > 0 &&
            ` · ${fields.length - requiredCount} optional`}
        </div>
      </form>
    </div>
  );
}

// ── Inline styles ────────────────────────────────────────────────
const styles = {
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "0",
    marginTop: "8px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
    overflow: "hidden",
    maxWidth: "640px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  header: {
    background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
    padding: "14px 20px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  headerIcon: { fontSize: "18px" },
  headerTitle: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "15px",
    letterSpacing: "0.3px",
  },
  fieldsGrid: {
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  fieldRow: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  label: {
    fontWeight: "600",
    fontSize: "13px",
    color: "#1e293b",
  },
  required: {
    color: "#ef4444",
    marginLeft: "2px",
  },
  description: {
    fontSize: "11px",
    color: "#64748b",
    marginBottom: "2px",
  },
  input: {
    border: "1.5px solid #cbd5e1",
    borderRadius: "7px",
    padding: "8px 12px",
    fontSize: "13px",
    color: "#0f172a",
    outline: "none",
    transition: "border-color 0.15s",
    width: "100%",
    boxSizing: "border-box",
    background: "#f8fafc",
  },
  inputError: {
    borderColor: "#ef4444",
    background: "#fff5f5",
  },
  errorMsg: {
    fontSize: "11px",
    color: "#ef4444",
    marginTop: "2px",
  },
  example: {
    fontSize: "11px",
    color: "#94a3b8",
    fontStyle: "italic",
  },
  validationBanner: {
    margin: "0 20px 12px",
    padding: "10px 14px",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    borderRadius: "8px",
    fontSize: "12px",
    color: "#c2410c",
    fontWeight: "500",
  },
  submitBtn: {
    margin: "0 20px 8px",
    width: "calc(100% - 40px)",
    padding: "11px",
    background: "linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    letterSpacing: "0.3px",
  },
  hint: {
    textAlign: "center",
    fontSize: "11px",
    color: "#94a3b8",
    paddingBottom: "14px",
  },
  submitted: {
    padding: "16px 20px",
    color: "#64748b",
    fontStyle: "italic",
    fontSize: "13px",
  },
};

import React, { useState, useEffect } from "react";
import type { Node } from "@xyflow/react";

type ConfigField = {
  type: string; // string | number | boolean | select | code | template | json
  label: string;
  required?: boolean;
  default?: unknown;
  options?: (string | { label: string; value: string })[];
  placeholder?: string;
  description?: string;
};

export default function NodeProperties({
  node,
  onConfigUpdate,
}: {
  node: Node;
  onConfigUpdate: (config: Record<string, unknown>) => void;
}) {
  const data = node.data as {
    label: string;
    nodeType: string;
    icon: string;
    color: string;
    config: Record<string, unknown>;
    configSchema: Record<string, unknown>;
  };

  const [config, setConfig] = useState<Record<string, unknown>>(data.config ?? {});

  useEffect(() => {
    setConfig(data.config ?? {});
  }, [node.id, data.config]);

  const schema = data.configSchema ?? {};
  const fields = Object.entries(schema) as [string, ConfigField][];

  const updateField = (key: string, value: unknown) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    onConfigUpdate(next);
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Node header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{
          width: "28px",
          height: "28px",
          borderRadius: "6px",
          background: data.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "14px",
        }}>
          {data.icon}
        </span>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--j-text)" }}>
            {data.label}
          </div>
          <div style={{ fontSize: "10px", color: "var(--j-text-muted)" }}>
            {data.nodeType}
          </div>
        </div>
      </div>

      <div style={{ height: "1px", background: "var(--j-border)" }} />

      {/* Config fields */}
      {fields.length === 0 ? (
        <div style={{ fontSize: "12px", color: "var(--j-text-dim)", textAlign: "center", padding: "12px 0" }}>
          No configuration needed
        </div>
      ) : (
        fields.map(([key, field]) => (
          <FieldEditor
            key={`${node.id}-${key}`}
            fieldKey={key}
            field={field}
            value={config[key]}
            onChange={(val) => updateField(key, val)}
          />
        ))
      )}

      {/* Node ID */}
      <div style={{ marginTop: "auto", paddingTop: "12px", borderTop: "1px solid var(--j-border)" }}>
        <div style={{ fontSize: "10px", color: "var(--j-text-muted)" }}>
          ID: {node.id}
        </div>
      </div>
    </div>
  );
}

function FieldEditor({
  fieldKey,
  field,
  value,
  onChange,
}: {
  fieldKey: string;
  field: ConfigField;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const label = field.label || fieldKey;
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid var(--j-border)",
    background: "var(--j-bg)",
    color: "var(--j-text)",
    fontSize: "12px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  const renderInput = () => {
    switch (field.type) {
      case "boolean":
        return (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!value}
              onChange={e => onChange(e.target.checked)}
              style={{ accentColor: "var(--j-accent)" }}
            />
            <span style={{ fontSize: "12px", color: "var(--j-text)" }}>{label}</span>
          </label>
        );

      case "number":
        return (
          <input
            type="number"
            value={value != null ? String(value) : ""}
            onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)}
            placeholder={field.placeholder ?? String(field.default ?? "")}
            style={inputStyle}
          />
        );

      case "select":
        return (
          <select
            value={String(value ?? field.default ?? "")}
            onChange={e => onChange(e.target.value)}
            style={inputStyle}
          >
            <option value="">— Select —</option>
            {(field.options ?? []).map(opt => {
              const val = typeof opt === 'string' ? opt : opt.value;
              const lbl = typeof opt === 'string' ? opt : opt.label;
              return <option key={val} value={val}>{lbl}</option>;
            })}
          </select>
        );

      case "code":
      case "template":
        return (
          <textarea
            value={String(value ?? "")}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder ?? ""}
            rows={4}
            style={{
              ...inputStyle,
              fontFamily: "monospace",
              fontSize: "11px",
              resize: "vertical",
              minHeight: "60px",
            }}
          />
        );

      case "json":
        return (
          <textarea
            value={typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2)}
            onChange={e => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                onChange(e.target.value);
              }
            }}
            placeholder="{}"
            rows={4}
            style={{
              ...inputStyle,
              fontFamily: "monospace",
              fontSize: "11px",
              resize: "vertical",
              minHeight: "60px",
            }}
          />
        );

      default: // string
        return (
          <input
            type="text"
            value={String(value ?? "")}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder ?? String(field.default ?? "")}
            style={inputStyle}
          />
        );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {field.type !== "boolean" && (
        <label style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--j-text-dim)",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}>
          {label}
          {field.required && <span style={{ color: "var(--j-error, #ef4444)" }}>*</span>}
        </label>
      )}
      {renderInput()}
      {field.description && (
        <div style={{ fontSize: "10px", color: "var(--j-text-muted)", lineHeight: "1.3" }}>
          {field.description}
        </div>
      )}
    </div>
  );
}

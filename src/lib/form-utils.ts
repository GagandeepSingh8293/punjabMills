/** Flattens a plain nested object (e.g. a header patch) into leaf dot-path/value pairs. */
export function flattenObjectPaths(
  obj: Record<string, unknown>,
  prefix = ""
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenObjectPaths(value as Record<string, unknown>, path));
    } else {
      out.push([path, value]);
    }
  }
  return out;
}

const FIELD_LABELS: Record<string, string> = {
  vehicleNo: "Vehicle No.",
  eWayNo: "E-Way No.",
  challanDate: "Challan Date",
  challanNo: "Challan No.",
  billing: "Billing",
  shipping: "Shipping",
  name: "Name",
  address: "Address",
  gstin: "GSTIN No.",
  state: "State",
  stateCode: "State Code",
  mobile: "Mobile No.",
};

/** Turns a full field path like "header.shipping.mobile" into "Shipping Mobile No." for display. */
export function humanizeFieldPath(path: string): string {
  return path
    .replace(/^header\./, "")
    .split(".")
    .map((part) => FIELD_LABELS[part] ?? part)
    .join(" ");
}

/** Flattens react-hook-form's nested `formState.dirtyFields` object into dot-path strings. */
export function flattenDirtyFields(node: unknown, prefix = "", out: Set<string> = new Set()): Set<string> {
  if (node === true) {
    if (prefix) out.add(prefix);
    return out;
  }
  if (Array.isArray(node)) {
    if (prefix) out.add(prefix);
    node.forEach((child, i) => flattenDirtyFields(child, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      flattenDirtyFields(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}
/**
 * useColorByCode.ts
 *
 * Custom hook for the "Color By Activity Code" feature.
 *
 * EXTRACTED FROM: GanttViewerAdvanced.tsx
 *
 * Fetches code assignments for a selected code type, decodes P6 color integers,
 * falls back to deterministic hash colors, and caches results per code type.
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export type CodeAssignmentMap = Map<string, Map<string, string>>;
export type CodeColorMap = Map<string, string>;

export interface ColorByCodeResult {
  codeAssignments: CodeAssignmentMap;
  codeColors: CodeColorMap;
  codeTypeName: string;
  loading: boolean;
}

interface CacheEntry {
  assignments: CodeAssignmentMap;
  colors: CodeColorMap;
  typeName: string;
}

const PAGE_SIZE = 1000;

export function useColorByCode(
  versionId: string | undefined,
  codeTypeId: string | undefined | null
): ColorByCodeResult {
  const [codeAssignments, setCodeAssignments] = useState<CodeAssignmentMap>(new Map());
  const [codeColors, setCodeColors] = useState<CodeColorMap>(new Map());
  const [codeTypeName, setCodeTypeName] = useState('');
  const [loading, setLoading] = useState(false);

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!codeTypeId) {
      setCodeAssignments(new Map());
      setCodeColors(new Map());
      setCodeTypeName('');
      return;
    }

    const cached = cacheRef.current.get(codeTypeId);
    if (cached) {
      setCodeAssignments(cached.assignments);
      setCodeColors(cached.colors);
      setCodeTypeName(cached.typeName);
      return;
    }

    loadColorByCodeType(codeTypeId);
  }, [codeTypeId, versionId]);

  async function loadColorByCodeType(typeId: string) {
    if (!versionId) return;

    try {
      setLoading(true);

      // Fetch all code assignments using server-side !inner JOIN filter
      const allAssignments: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('cpm_code_assignments')
          .select(`
            activity_id,
            code_value_id,
            cpm_code_values!inner (
              id,
              code_type_id,
              code_value_name,
              code_value_color
            )
          `)
          .eq('schedule_version_id', versionId)
          .eq('cpm_code_values.code_type_id', typeId)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) { console.error('Error loading code assignments for color:', error); break; }
        if (data && data.length > 0) {
          allAssignments.push(...data);
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else { hasMore = false; }
      }

      if (!mountedRef.current) return;

      // Build assignments map
      const newAssignments: CodeAssignmentMap = new Map();
      const uniqueValues = new Set<string>();

      for (const assignment of allAssignments) {
        const codeValue = assignment.cpm_code_values;
        if (!codeValue) continue;
        if (!newAssignments.has(assignment.activity_id)) {
          newAssignments.set(assignment.activity_id, new Map());
        }
        newAssignments.get(assignment.activity_id)!.set(codeValue.code_type_id, codeValue.code_value_name);
        uniqueValues.add(codeValue.code_value_name);
      }

      // Build color map — P6 colors first, hash fallback
      const p6ColorMap = new Map<string, number>();
      for (const assignment of allAssignments) {
        const cv = assignment.cpm_code_values;
        if (cv?.code_value_color != null && !p6ColorMap.has(cv.code_value_name)) {
          p6ColorMap.set(cv.code_value_name, cv.code_value_color);
        }
      }

      const newColors: CodeColorMap = new Map();
      for (const valueName of uniqueValues) {
        const p6Color = p6ColorMap.get(valueName);
        if (p6Color != null && p6Color > 0) {
          const r = (p6Color >> 16) & 0xFF;
          const g = (p6Color >> 8) & 0xFF;
          const b = p6Color & 0xFF;
          newColors.set(valueName, `rgb(${r}, ${g}, ${b})`);
        } else {
          newColors.set(valueName, hashColor(valueName));
        }
      }

      // Fetch code type display name
      let typeName = '';
      const { data: typeData } = await supabase
        .from('cpm_code_types')
        .select('code_type_name')
        .eq('id', typeId)
        .maybeSingle();
      if (typeData) typeName = typeData.code_type_name;

      if (!mountedRef.current) return;

      setCodeAssignments(newAssignments);
      setCodeColors(newColors);
      setCodeTypeName(typeName);

      cacheRef.current.set(typeId, { assignments: newAssignments, colors: newColors, typeName });
    } catch (error) {
      console.error('Failed to load color-by code assignments:', error);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  return { codeAssignments, codeColors, codeTypeName, loading };
}

/** Deterministic HSL color from a string hash */
function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

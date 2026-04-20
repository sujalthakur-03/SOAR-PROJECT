/**
 * ObservableFieldPicker
 *
 * A searchable dropdown that lets analysts pick a field from the incoming
 * alert (trigger data) or from the outputs of any previous step, instead of
 * hand-typing template strings like `{{trigger_data.agent.id}}`.
 *
 * The value remains a plain string for DSL compatibility — the picker just
 * makes it safer to produce that string. Analysts may also switch to a
 * literal text input (when `allowLiteral` is true) to enter a hardcoded
 * value.
 */

import { useMemo, useState, useEffect } from 'react';
import { ChevronsUpDown, Check, Pencil, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  getAllAvailableFields,
  type ObservableField,
  type ObservableFieldType,
  type PreviousStepDescriptor,
} from './observable-fields';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ObservableFieldPickerProps {
  /** Current string value (template or literal) */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  tooltip?: string;
  required?: boolean;
  /** Filter the dropdown by expected value type */
  fieldType?: ObservableFieldType;
  /** The step being configured — used to hide its own & future outputs */
  currentStepId?: string;
  /** Previous steps (in execution order) whose outputs should be available */
  previousSteps?: PreviousStepDescriptor[];
  /** If true, offers a "Type custom value" escape hatch */
  allowLiteral?: boolean;
  /** Error string to render under the input */
  error?: string;
  /** Optional className applied to the outer wrapper */
  className?: string;
  /** Disable interaction */
  disabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function typeBadgeClass(type: ObservableField['type']): string {
  switch (type) {
    case 'ip':
      return 'bg-sky-500/10 text-sky-500 border-sky-500/30';
    case 'id':
      return 'bg-violet-500/10 text-violet-500 border-violet-500/30';
    case 'number':
      return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
    case 'boolean':
      return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
    case 'url':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
    case 'hash':
      return 'bg-pink-500/10 text-pink-500 border-pink-500/30';
    case 'string':
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function isTemplate(v: string | undefined): boolean {
  return !!v && v.includes('{{') && v.includes('}}');
}

/** Does a field's type satisfy the picker's requested type? */
function matchesFieldType(
  field: ObservableField,
  requested: ObservableFieldType | undefined,
): boolean {
  if (!requested || requested === 'any') return true;
  return field.type === requested;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function ObservableFieldPicker({
  value,
  onChange,
  placeholder = 'Select a field…',
  label,
  tooltip: _tooltip,
  required,
  fieldType = 'any',
  currentStepId,
  previousSteps = [],
  allowLiteral = true,
  error,
  className,
  disabled,
}: ObservableFieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [literalMode, setLiteralMode] = useState(false);

  // Build the full catalog of available fields once per render.
  const available = useMemo(
    () => getAllAvailableFields(currentStepId, previousSteps),
    [currentStepId, previousSteps],
  );

  // Filter by requested type
  const filtered = useMemo(
    () => available.filter((f) => matchesFieldType(f, fieldType)),
    [available, fieldType],
  );

  // Group by category + source step id
  const { triggerGroup, stepGroups } = useMemo(() => {
    const trig: ObservableField[] = [];
    const byStep = new Map<string, { label: string; fields: ObservableField[] }>();

    for (const f of filtered) {
      if (f.category === 'trigger') {
        trig.push(f);
      } else if (f.sourceStepId) {
        const entry =
          byStep.get(f.sourceStepId) ||
          { label: f.sourceStepLabel || f.sourceStepId, fields: [] };
        entry.fields.push(f);
        byStep.set(f.sourceStepId, entry);
      }
    }
    return {
      triggerGroup: trig,
      stepGroups: Array.from(byStep.entries()).map(([id, v]) => ({
        id,
        ...v,
      })),
    };
  }, [filtered]);

  // Find the field currently selected (if value matches a known template)
  const selectedField = useMemo(
    () => available.find((f) => f.template === value),
    [available, value],
  );

  // If the value is a non-empty, non-template value and not matching a field,
  // treat it as a literal and auto-enter literal mode on first mount.
  useEffect(() => {
    if (value && !isTemplate(value) && !selectedField && allowLiteral) {
      setLiteralMode(true);
    }
  }, [value, selectedField, allowLiteral]);

  const handlePick = (field: ObservableField) => {
    onChange(field.template);
    setLiteralMode(false);
    setOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setLiteralMode(false);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────

  const showingLiteral = literalMode || (!!value && !isTemplate(value) && !selectedField);

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label className="text-sm">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}

      {showingLiteral ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(error && 'border-destructive')}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Pick a field from alert or previous step"
            onClick={() => {
              setLiteralMode(false);
              setOpen(true);
            }}
            disabled={disabled}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              disabled={disabled}
              className={cn(
                'w-full justify-between font-normal',
                !value && 'text-muted-foreground',
                error && 'border-destructive',
              )}
            >
              <span className="truncate text-left">
                {selectedField ? (
                  <span className="flex items-center gap-2">
                    <span>{selectedField.label}</span>
                    <Badge
                      variant="outline"
                      className={cn('text-[9px] h-4 px-1', typeBadgeClass(selectedField.type))}
                    >
                      {selectedField.type.toUpperCase()}
                    </Badge>
                  </span>
                ) : value ? (
                  <code className="text-xs">{value}</code>
                ) : (
                  placeholder
                )}
              </span>
              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[360px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search fields…" />
              <CommandList className="max-h-[320px]">
                <CommandEmpty>No fields match your filter.</CommandEmpty>

                {triggerGroup.length > 0 && (
                  <CommandGroup heading="Alert (Trigger Data)">
                    {triggerGroup.map((f) => (
                      <FieldItem
                        key={f.path}
                        field={f}
                        selected={selectedField?.path === f.path}
                        onSelect={() => handlePick(f)}
                      />
                    ))}
                  </CommandGroup>
                )}

                {stepGroups.map((g) => (
                  <div key={g.id}>
                    <CommandSeparator />
                    <CommandGroup heading={`Step: ${g.label}`}>
                      {g.fields.map((f) => (
                        <FieldItem
                          key={f.path}
                          field={f}
                          selected={selectedField?.path === f.path}
                          onSelect={() => handlePick(f)}
                        />
                      ))}
                    </CommandGroup>
                  </div>
                ))}

                {allowLiteral && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Literal">
                      <CommandItem
                        value="__literal__"
                        onSelect={() => {
                          setLiteralMode(true);
                          setOpen(false);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                        <span>Type custom value…</span>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {/* Runtime preview */}
      {selectedField && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <span className="opacity-60">→</span>
          <span>{selectedField.description}</span>
        </p>
      )}
      {!selectedField && isTemplate(value) && (
        <p className="text-[11px] text-muted-foreground">
          Resolves at runtime from <code className="bg-muted px-1 rounded">{value}</code>
        </p>
      )}
      {!selectedField && !!value && !isTemplate(value) && (
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] text-muted-foreground flex-1">
            Literal value. It will be used as-is at runtime.
          </p>
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-0.5"
          >
            <X className="h-3 w-3" /> clear
          </button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field item row
// ─────────────────────────────────────────────────────────────────────────────

function FieldItem({
  field,
  selected,
  onSelect,
}: {
  field: ObservableField;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`${field.label} ${field.path} ${field.description}`}
      onSelect={onSelect}
      className="items-start"
    >
      <Check
        className={cn(
          'h-3.5 w-3.5 mt-0.5 mr-2 shrink-0',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{field.label}</span>
          <Badge
            variant="outline"
            className={cn('text-[9px] h-4 px-1 shrink-0', typeBadgeClass(field.type))}
          >
            {field.type.toUpperCase()}
          </Badge>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono truncate">
          {field.path}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {field.description}
        </div>
      </div>
    </CommandItem>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert-field helper for textareas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A smaller "+ Insert Field" button designed to be attached to a Textarea.
 * When a field is picked, it inserts the template string at the caller's
 * current cursor position (tracked externally) by calling `onInsert`.
 */
export function InsertFieldButton({
  currentStepId,
  previousSteps = [],
  onInsert,
  disabled,
  className,
}: {
  currentStepId?: string;
  previousSteps?: PreviousStepDescriptor[];
  onInsert: (template: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () => getAllAvailableFields(currentStepId, previousSteps),
    [currentStepId, previousSteps],
  );

  const { triggerGroup, stepGroups } = useMemo(() => {
    const trig: ObservableField[] = [];
    const byStep = new Map<string, { label: string; fields: ObservableField[] }>();
    for (const f of available) {
      if (f.category === 'trigger') {
        trig.push(f);
      } else if (f.sourceStepId) {
        const entry =
          byStep.get(f.sourceStepId) ||
          { label: f.sourceStepLabel || f.sourceStepId, fields: [] };
        entry.fields.push(f);
        byStep.set(f.sourceStepId, entry);
      }
    }
    return {
      triggerGroup: trig,
      stepGroups: Array.from(byStep.entries()).map(([id, v]) => ({ id, ...v })),
    };
  }, [available]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-7 text-xs', className)}
          disabled={disabled}
        >
          <Sparkles className="h-3 w-3 mr-1" />
          Insert Field
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search fields…" />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No fields available.</CommandEmpty>
            {triggerGroup.length > 0 && (
              <CommandGroup heading="Alert (Trigger Data)">
                {triggerGroup.map((f) => (
                  <FieldItem
                    key={f.path}
                    field={f}
                    selected={false}
                    onSelect={() => {
                      onInsert(f.template);
                      setOpen(false);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
            {stepGroups.map((g) => (
              <div key={g.id}>
                <CommandSeparator />
                <CommandGroup heading={`Step: ${g.label}`}>
                  {g.fields.map((f) => (
                    <FieldItem
                      key={f.path}
                      field={f}
                      selected={false}
                      onSelect={() => {
                        onInsert(f.template);
                        setOpen(false);
                      }}
                    />
                  ))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

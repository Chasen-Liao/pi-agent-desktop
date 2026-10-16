"use client";

import { useEffect, useId, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor,
  closestCenter, pointerWithin, useSensor, useSensors, type CollisionDetection,
  type DragEndEvent, type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext, defaultAnimateLayoutChanges, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "../I18nProvider";
import { SidebarIcon } from "./SidebarIcon";
import { moveProject, type SidebarProject } from "./projects";

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const modifiers = [verticalOnly];
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const motionSnapshot = () => window.matchMedia(motionQuery).matches;
const serverMotionSnapshot = () => true;
type MotionSettings = { duration: number; easing: string };

function SortableProject({ project, disabled, motion, animateChanges, render }: {
  project: SidebarProject;
  disabled: boolean;
  motion: MotionSettings | null;
  animateChanges: boolean;
  render: (handle: ReactNode, dragging: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: project.key,
    disabled,
    transition: motion,
    animateLayoutChanges: (args) => animateChanges && !!motion && (
      args.items !== args.previousItems || defaultAnimateLayoutChanges(args)
    ),
  });
  const handle = <button
    ref={setActivatorNodeRef} {...attributes} {...listeners}
    className="sidebar-project-drag-handle" disabled={disabled}
    aria-label={t("sidebar.reorderProject", { name: project.name })}
    title={t(disabled ? "sidebar.reorderSearchDisabled" : "sidebar.reorderProject", { name: project.name })}
  ><SidebarIcon name="grip" size={13} /></button>;
  return <div ref={setNodeRef} className="sidebar-sortable-project" data-dragging={isDragging || undefined} style={{
    transform: CSS.Translate.toString(transform),
    transition: animateChanges ? transition : undefined,
  }}>{render(handle, isDragging)}</div>;
}

export function SortableProjects({ projects, disabled, animateChanges, listRef, onReorder, renderProject }: {
  projects: SidebarProject[];
  disabled: boolean;
  animateChanges: boolean;
  listRef: RefObject<HTMLElement | null>;
  onReorder: (keys: string[]) => void;
  renderProject: (project: SidebarProject, handle: ReactNode, dragging: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
  const [motion, setMotion] = useState<MotionSettings | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [keyboardDrag, setKeyboardDrag] = useState(false);
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const duration = styles.getPropertyValue("--duration-fast").trim();
    setMotion({
      duration: parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000),
      easing: styles.getPropertyValue("--ease-smooth-out").trim(),
    });
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }),
  );
  const keys = projects.map((project) => project.key);
  const activeProject = projects.find((project) => project.key === activeKey);
  const shouldAnimate = !reducedMotion && (activeKey ? !keyboardDrag : animateChanges);
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = args.pointerCoordinates;
    if (!pointer) return closestCenter(args);
    const bounds = listRef.current?.getBoundingClientRect();
    if (bounds && (pointer.x < bounds.left || pointer.x > bounds.right || pointer.y < bounds.top || pointer.y > bounds.bottom)) return [];
    const within = pointerWithin(args);
    return within.length ? within : closestCenter({ ...args, collisionRect: {
      ...args.collisionRect, top: pointer.y, bottom: pointer.y, left: pointer.x, right: pointer.x, width: 0, height: 0,
    } });
  };
  const finishDrag = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      onReorder(moveProject(keys, String(active.id), String(over.id)));
    }
    setActiveKey(null);
  };
  const projectLabel = (key: string | number) => projects.find((project) => project.key === key)?.name ?? String(key);
  return <DndContext
    id={id} sensors={sensors} modifiers={modifiers} collisionDetection={collisionDetection}
    measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    onDragStart={({ active, activatorEvent }) => {
      setKeyboardDrag(activatorEvent instanceof KeyboardEvent);
      setActiveKey(String(active.id));
    }}
    onDragEnd={finishDrag} onDragCancel={() => setActiveKey(null)}
    accessibility={{
      screenReaderInstructions: { draggable: t("sidebar.reorderInstructions") },
      announcements: {
        onDragStart: ({ active }) => t("sidebar.reorderPickedUp", { name: projectLabel(active.id) }),
        onDragOver: ({ active, over }) => over ? t("sidebar.reorderPosition", { name: projectLabel(active.id), position: keys.indexOf(String(over.id)) + 1, count: keys.length }) : undefined,
        onDragEnd: ({ active, over }) => over ? t("sidebar.reorderPlaced", { name: projectLabel(active.id), position: keys.indexOf(String(over.id)) + 1 }) : t("sidebar.reorderCancelled"),
        onDragCancel: () => t("sidebar.reorderCancelled"),
      },
    }}
  >
    <SortableContext items={keys} strategy={verticalListSortingStrategy}>
      {projects.map((project) => <SortableProject key={project.key} project={project} disabled={disabled} motion={shouldAnimate ? motion : null} animateChanges={shouldAnimate} render={(handle, dragging) => renderProject(project, handle, dragging)} />)}
    </SortableContext>
    {motion && createPortal(<DragOverlay modifiers={modifiers} adjustScale={false} dropAnimation={!reducedMotion && !keyboardDrag ? motion : null} transition="none" zIndex={1100}>
      {activeProject && <div className="sidebar-project-drag-preview" aria-hidden="true">
        <SidebarIcon name="grip" size={13} />
        <SidebarIcon name="folder" size={17} />
        <span>{activeProject.name}</span>
        <span className="sidebar-drag-count">{activeProject.sessions.length}</span>
      </div>}
    </DragOverlay>, document.body)}
  </DndContext>;
}

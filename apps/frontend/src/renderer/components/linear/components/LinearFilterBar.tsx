/**
 * Filter bar for Linear tickets list
 * Grid layout: Search | Team | Project | Status | Labels | Assignee | Priority
 * Multi-select dropdowns with visible chip selections
 */

import {
	Badge as BadgeIcon,
	Check,
	type Filter,
	Flag,
	FolderKanban,
	Search,
	Tag,
	User,
	Users,
	X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LinearFilters } from "../../../../shared/types/integrations";
import { cn } from "../../../lib/utils";
import { useLinearStore } from "../../../stores/linear-store";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Input } from "../../ui/input";
import { Separator } from "../../ui/separator";

interface LinearFilterBarProps {
	filters: LinearFilters;
	searchQuery: string;
	hasActiveFilters: boolean;
	onSearchChange: (query: string) => void;
	onTeamChange: (teamId: string | undefined) => void;
	onProjectChange: (projectId: string | undefined) => void;
	onStatusChange: (status: string | undefined) => void;
	onLabelsChange: (labels: string[]) => void;
	onAssigneeChange: (assigneeId: string | undefined) => void;
	onPriorityChange: (priority: number | undefined) => void;
	onClearFilters: () => void;
}

// Priority options
const PRIORITY_OPTIONS: Array<{
	value: number;
	label: string;
	icon: typeof Flag;
	color: string;
	bgColor: string;
}> = [
	{
		value: 0,
		label: "No priority",
		icon: Flag,
		color: "text-slate-400",
		bgColor: "bg-slate-500/20",
	},
	{
		value: 1,
		label: "Urgent",
		icon: Flag,
		color: "text-red-400",
		bgColor: "bg-red-500/20",
	},
	{
		value: 2,
		label: "High",
		icon: Flag,
		color: "text-orange-400",
		bgColor: "bg-orange-500/20",
	},
	{
		value: 3,
		label: "Medium",
		icon: Flag,
		color: "text-yellow-400",
		bgColor: "bg-yellow-500/20",
	},
	{
		value: 4,
		label: "Low",
		icon: Flag,
		color: "text-blue-400",
		bgColor: "bg-blue-500/20",
	},
];

interface FilterDropdownProps<T extends string> {
	title: string;
	icon: typeof Users;
	items: T[];
	selected: T[];
	onChange: (selected: T[]) => void;
	renderItem?: (item: T) => React.ReactNode;
	renderTrigger?: (selected: T[]) => React.ReactNode;
	searchable?: boolean;
	searchPlaceholder?: string;
	selectedCountLabel?: string;
	noResultsLabel?: string;
	clearLabel?: string;
}

/**
 * Modern Filter Dropdown Component
 */
function FilterDropdown<T extends string>({
	title,
	icon: Icon,
	items,
	selected,
	onChange,
	renderItem,
	renderTrigger,
	searchable = false,
	searchPlaceholder,
	selectedCountLabel,
	noResultsLabel,
	clearLabel,
}: FilterDropdownProps<T>) {
	const [searchTerm, setSearchTerm] = useState("");
	const [isOpen, setIsOpen] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(-1);
	const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

	const toggleItem = useCallback(
		(item: T) => {
			if (selected.includes(item)) {
				onChange(selected.filter((s) => s !== item));
			} else {
				onChange([...selected, item]);
			}
		},
		[selected, onChange],
	);

	const filteredItems = useMemo(() => {
		if (!searchTerm) return items;
		return items.filter((item) =>
			item.toLowerCase().includes(searchTerm.toLowerCase()),
		);
	}, [items, searchTerm]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (filteredItems.length === 0) return;

			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setFocusedIndex((prev) =>
						prev < filteredItems.length - 1 ? prev + 1 : 0,
					);
					break;
				case "ArrowUp":
					e.preventDefault();
					setFocusedIndex((prev) =>
						prev > 0 ? prev - 1 : filteredItems.length - 1,
					);
					break;
				case "Enter":
				case " ":
					e.preventDefault();
					if (focusedIndex >= 0 && focusedIndex < filteredItems.length) {
						toggleItem(filteredItems[focusedIndex]);
					}
					break;
				case "Escape":
					setIsOpen(false);
					break;
			}
		},
		[filteredItems, focusedIndex, toggleItem],
	);

	return (
		<DropdownMenu
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) {
					setSearchTerm("");
					setFocusedIndex(-1);
				}
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn(
						"h-8 w-full justify-start border-dashed bg-transparent",
						selected.length > 0 && "border-solid bg-accent/50",
					)}
				>
					<Icon className="mr-2 h-4 w-4 text-muted-foreground" />
					<span className="truncate">{title}</span>
					{selected.length > 0 && (
						<>
							<Separator orientation="vertical" className="mx-2 h-4" />
							<Badge
								variant="secondary"
								className="rounded-sm px-1 font-normal lg:hidden"
							>
								{selected.length}
							</Badge>
							<div className="hidden space-x-1 lg:flex flex-1 truncate">
								{selected.length > 2 ? (
									<Badge
										variant="secondary"
										className="rounded-sm px-1 font-normal"
									>
										{selectedCountLabel}
									</Badge>
								) : renderTrigger ? (
									renderTrigger(selected)
								) : (
									selected.map((item) => (
										<Badge
											variant="secondary"
											key={item}
											className="rounded-sm px-1 font-normal"
										>
											{item}
										</Badge>
									))
								)}
							</div>
						</>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-[240px] p-0">
				<div className="px-3 py-2 border-b border-border/50">
					<div className="text-xs font-semibold text-muted-foreground mb-1">
						{title}
					</div>
					{searchable && (
						<div className="relative">
							<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
							<Input
								placeholder={searchPlaceholder}
								className="h-7 text-xs pl-7 bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50"
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								onKeyDown={(e) => e.stopPropagation()}
							/>
						</div>
					)}
				</div>

				<div
					className="max-h-[300px] overflow-y-auto custom-scrollbar p-1"
					role="listbox"
					aria-multiselectable="true"
					onKeyDown={handleKeyDown}
					tabIndex={0}
				>
					{filteredItems.length === 0 ? (
						<div className="p-3 text-xs text-muted-foreground text-center">
							{noResultsLabel}
						</div>
					) : (
						filteredItems.map((item, index) => {
							const isSelected = selected.includes(item);
							const isFocused = index === focusedIndex;
							return (
								<div
									key={item}
									ref={(el) => {
										itemRefs.current[index] = el;
									}}
									role="option"
									aria-selected={isSelected}
									className={cn(
										"relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
										isSelected && "bg-accent/50",
										isFocused && "ring-2 ring-primary/50 bg-accent",
									)}
									onClick={(e) => {
										e.preventDefault();
										toggleItem(item);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											toggleItem(item);
										}
									}}
									tabIndex={-1}
								>
									<div
										className={cn(
											"mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary/30",
											isSelected
												? "bg-primary border-primary text-primary-foreground"
												: "opacity-50 [&_svg]:invisible",
										)}
									>
										<Check className={cn("h-3 w-3")} />
									</div>
									{renderItem ? renderItem(item) : item}
								</div>
							);
						})
					)}
				</div>

				{selected.length > 0 && (
					<div className="p-1 border-t border-border/50 bg-muted/20">
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-center text-xs h-7 hover:bg-destructive/10 hover:text-destructive"
							onClick={() => onChange([])}
						>
							{clearLabel}
						</Button>
					</div>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

interface SingleSelectDropdownProps {
	title: string;
	icon: typeof Filter;
	items: Array<{ value: string; label: string }>;
	selected: string | undefined;
	onChange: (value: string | undefined) => void;
	renderItem?: (item: { value: string; label: string }) => React.ReactNode;
	renderTrigger?: (selected: string | undefined) => React.ReactNode;
	clearLabel?: string;
}

/**
 * Single-select filter dropdown (for team, project, status, assignee, priority)
 */
function SingleSelectDropdown({
	title,
	icon: Icon,
	items,
	selected,
	onChange,
	renderItem,
	renderTrigger,
	clearLabel,
}: SingleSelectDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);

	const handleSelect = useCallback(
		(value: string) => {
			onChange(selected === value ? undefined : value);
			setIsOpen(false);
		},
		[selected, onChange],
	);

	const handleClear = useCallback(() => {
		onChange(undefined);
		setIsOpen(false);
	}, [onChange]);

	const selectedItem = items.find((item) => item.value === selected);

	return (
		<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={cn(
						"h-8 w-full justify-start border-dashed bg-transparent",
						selected && "border-solid bg-accent/50",
					)}
				>
					<Icon className="mr-2 h-4 w-4 text-muted-foreground" />
					<span className="truncate">
						{selected ? selectedItem?.label : title}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-[240px] p-0">
				<div className="px-3 py-2 border-b border-border/50">
					<div className="text-xs font-semibold text-muted-foreground">
						{title}
					</div>
				</div>

				<div
					className="max-h-[300px] overflow-y-auto custom-scrollbar p-1"
					role="listbox"
				>
					{items.map((item) => {
						const isSelected = selected === item.value;
						return (
							<div
								key={item.value}
								role="option"
								aria-selected={isSelected}
								className={cn(
									"relative flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
									isSelected && "bg-accent/50",
								)}
								onClick={() => handleSelect(item.value)}
							>
								<div
									className={cn(
										"mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary/30",
										isSelected
											? "bg-primary border-primary text-primary-foreground"
											: "opacity-50 [&_svg]:invisible",
									)}
								>
									<Check className={cn("h-3 w-3")} />
								</div>
								{renderItem ? renderItem(item) : item.label}
							</div>
						);
					})}
				</div>

				{selected && (
					<div className="p-1 border-t border-border/50 bg-muted/20">
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-center text-xs h-7 hover:bg-destructive/10 hover:text-destructive"
							onClick={handleClear}
						>
							{clearLabel}
						</Button>
					</div>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function LinearFilterBar({
	filters,
	searchQuery,
	hasActiveFilters,
	onSearchChange,
	onTeamChange,
	onProjectChange,
	onStatusChange,
	onLabelsChange,
	onAssigneeChange,
	onPriorityChange,
	onClearFilters,
}: LinearFilterBarProps) {
	const { t } = useTranslation("common");

	// Get data from Linear store
	const storeTeams = useLinearStore((state) => state.teams);
	const storeProjects = useLinearStore((state) => state.projects);
	const storeTickets = useLinearStore((state) => state.tickets);

	// Extract unique values from tickets for dynamic filters
	const uniqueStatuses = useMemo(() => {
		const statusMap = new Map<string, string>();
		storeTickets.forEach((ticket) => {
			if (!statusMap.has(ticket.state.type)) {
				statusMap.set(ticket.state.type, ticket.state.name);
			}
		});
		return Array.from(statusMap.entries()).map(([value, label]) => ({
			value,
			label,
		}));
	}, [storeTickets]);

	const uniqueLabels = useMemo(() => {
		const labelSet = new Set<string>();
		storeTickets.forEach((ticket) => {
			ticket.labels.forEach((label) => {
				labelSet.add(label.name);
			});
		});
		return Array.from(labelSet).sort();
	}, [storeTickets]);

	const uniqueAssignees = useMemo(() => {
		const assigneeMap = new Map<string, { name: string; email?: string }>();
		storeTickets.forEach((ticket) => {
			if (ticket.assignee && !assigneeMap.has(ticket.assignee.id)) {
				assigneeMap.set(ticket.assignee.id, {
					name: ticket.assignee.name,
					email: ticket.assignee.email,
				});
			}
		});
		return Array.from(assigneeMap.entries()).map(([value, data]) => ({
			value,
			label: data.name,
		}));
	}, [storeTickets]);

	// Transform store data to filter format
	const teams = useMemo(
		() => storeTeams.map((team) => ({ value: team.id, label: team.name })),
		[storeTeams],
	);

	const projects = useMemo(
		() =>
			storeProjects.map((project) => ({
				value: project.id,
				label: project.name,
			})),
		[storeProjects],
	);

	const statuses = uniqueStatuses;
	const labels = uniqueLabels;
	const assignees = uniqueAssignees;

	return (
		<div className="px-4 py-2 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="flex items-center gap-2 h-9 overflow-x-auto">
				{/* Search Input */}
				<div className="relative flex-1 min-w-[200px] max-w-md">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder={t("linear.searchPlaceholder")}
						value={searchQuery}
						onChange={(e) => onSearchChange(e.target.value)}
						className="h-8 pl-9 bg-background/50 focus:bg-background transition-colors"
					/>
					{searchQuery && (
						<button
							onClick={() => onSearchChange("")}
							className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							aria-label={t("linear.clearSearch")}
						>
							<X className="h-3 w-3" />
						</button>
					)}
				</div>

				<Separator orientation="vertical" className="h-5 mx-1" />

				{/* Team Filter - Single Select */}
				<div className="flex-1 min-w-[140px] max-w-[200px]">
					<SingleSelectDropdown
						title={t("linear.allTeams")}
						icon={Users}
						items={teams}
						selected={filters.teamId}
						onChange={onTeamChange}
						clearLabel={t("linear.clearFilters")}
					/>
				</div>

				{/* Project Filter - Single Select */}
				<div className="flex-1 min-w-[140px] max-w-[200px]">
					<SingleSelectDropdown
						title={t("linear.allProjects")}
						icon={FolderKanban}
						items={projects}
						selected={filters.projectId}
						onChange={onProjectChange}
						clearLabel={t("linear.clearFilters")}
					/>
				</div>

				{/* Status Filter - Single Select */}
				<div className="flex-1 min-w-[140px] max-w-[200px]">
					<SingleSelectDropdown
						title={t("linear.allStatuses")}
						icon={BadgeIcon}
						items={statuses}
						selected={filters.status}
						onChange={onStatusChange}
						clearLabel={t("linear.clearFilters")}
					/>
				</div>

				{/* Labels Filter - Multi Select */}
				<div className="flex-1 min-w-[140px] max-w-[200px]">
					<FilterDropdown
						title={t("linear.labels")}
						icon={Tag}
						items={labels}
						selected={filters.labels || []}
						onChange={onLabelsChange}
						searchable={true}
						searchPlaceholder={t("linear.searchPlaceholder")}
						selectedCountLabel={t("linear.selectedCount", {
							count: filters.labels?.length || 0,
						})}
						noResultsLabel={t("linear.noResultsFound")}
						clearLabel={t("linear.clearFilters")}
						renderItem={(label) => (
							<div className="flex items-center gap-2">
								<Tag className="h-3 w-3 text-muted-foreground" />
								<span className="text-sm">{label}</span>
							</div>
						)}
					/>
				</div>

				{/* Assignee Filter - Single Select */}
				<div className="flex-1 min-w-[140px] max-w-[200px]">
					<SingleSelectDropdown
						title={t("linear.allAssignees")}
						icon={User}
						items={assignees}
						selected={filters.assigneeId}
						onChange={onAssigneeChange}
						clearLabel={t("linear.clearFilters")}
						renderItem={(item) => (
							<div className="flex items-center gap-2">
								<div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
									<span className="text-[10px] font-medium text-primary">
										{item.label.slice(0, 2).toUpperCase()}
									</span>
								</div>
								<span className="text-sm">{item.label}</span>
							</div>
						)}
					/>
				</div>

				{/* Priority Filter - Single Select */}
				<div className="flex-1 min-w-[140px] max-w-[200px]">
					<SingleSelectDropdown
						title={t("linear.allPriorities")}
						icon={Flag}
						items={PRIORITY_OPTIONS.map((opt) => ({
							value: opt.value.toString(),
							label: opt.label,
						}))}
						selected={filters.priority?.toString()}
						onChange={(value) =>
							onPriorityChange(value ? parseInt(value, 10) : undefined)
						}
						clearLabel={t("linear.clearFilters")}
						renderItem={(item) => {
							const priority = parseInt(item.value, 10) as number;
							const option = PRIORITY_OPTIONS.find(
								(opt) => opt.value === priority,
							);
							if (!option) return null;
							const Icon = option.icon;
							return (
								<div className="flex items-center gap-2">
									<div className={cn("p-1 rounded-full", option.bgColor)}>
										<Icon className={cn("h-3 w-3", option.color)} />
									</div>
									<span className="text-sm">{option.label}</span>
								</div>
							);
						}}
					/>
				</div>

				{/* Reset All */}
				{hasActiveFilters && (
					<>
						<Separator orientation="vertical" className="h-5 mx-1" />
						<Button
							variant="ghost"
							size="sm"
							onClick={onClearFilters}
							className="h-8 px-2 lg:px-3 text-muted-foreground hover:text-foreground"
						>
							<span className="hidden lg:inline mr-2">{t("linear.reset")}</span>
							<X className="h-4 w-4" />
						</Button>
					</>
				)}
			</div>
		</div>
	);
}

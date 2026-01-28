/**
 * Search bar for Linear tickets list
 * Displays a search input with icon and clear button
 */

import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "../../ui/input";

interface LinearSearchBarProps {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	placeholder?: string;
}

export function LinearSearchBar({
	searchQuery,
	onSearchChange,
	placeholder,
}: LinearSearchBarProps) {
	const { t } = useTranslation(["common", "linear"]);

	return (
		<div className="relative w-full">
			<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
			<Input
				placeholder={placeholder || t("linear:searchPlaceholder")}
				value={searchQuery}
				onChange={(e) => onSearchChange(e.target.value)}
				className="h-9 pl-9 pr-8 bg-background/50 focus:bg-background transition-colors"
			/>
			{searchQuery && (
				<button
					type="button"
					onClick={() => onSearchChange("")}
					className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
					aria-label={t("linear:clearSearch")}
				>
					<X className="h-3 w-3" />
				</button>
			)}
		</div>
	);
}

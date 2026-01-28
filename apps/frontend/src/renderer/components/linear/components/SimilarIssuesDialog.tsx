/**
 * Dialog for displaying and managing similar Linear tickets
 */

import { Link2, Merge, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";

export interface SimilarTicket {
	ticket_id: string;
	similarity_score: number;
	similarity_reasoning: string;
	confidence: "high" | "medium" | "low";
	recommended_action: "duplicate" | "related" | "distinct";
	shared_keywords?: string[];
	differences?: string;
}

interface SimilarIssuesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	targetTicketId: string;
	similarTickets: SimilarTicket[];
	onMarkDuplicate?: (parentTicketId: string, duplicateTicketId: string) => void;
	onLinkTickets?: (ticketId1: string, ticketId2: string) => void;
	isLoading?: boolean;
}

export function SimilarIssuesDialog({
	open,
	onOpenChange,
	targetTicketId,
	similarTickets,
	onMarkDuplicate,
	onLinkTickets,
	isLoading = false,
}: SimilarIssuesDialogProps) {
	const { t } = useTranslation(["common", "linear"]);

	const duplicates = similarTickets.filter(
		(t) => t.recommended_action === "duplicate",
	);
	const related = similarTickets.filter(
		(t) => t.recommended_action === "related",
	);

	const getConfidenceColor = (confidence: string) => {
		switch (confidence) {
			case "high":
				return "bg-green-500/20 text-green-700 dark:text-green-400";
			case "medium":
				return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400";
			case "low":
				return "bg-gray-500/20 text-gray-700 dark:text-gray-400";
			default:
				return "bg-gray-500/20 text-gray-700";
		}
	};

	const getActionColor = (action: string) => {
		switch (action) {
			case "duplicate":
				return "bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30";
			case "related":
				return "bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30";
			case "distinct":
				return "bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30";
			default:
				return "bg-gray-500/20";
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Link2 className="h-5 w-5" />
						{t("linear:similarIssuesFor", { ticketId: targetTicketId })}
					</DialogTitle>
					<DialogDescription>
						{t("linear:similarIssuesDescription")}
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<div className="text-muted-foreground">
							{t("linear:analyzingSimilarity")}
						</div>
					</div>
				) : similarTickets.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<Link2 className="h-12 w-12 text-muted-foreground mb-4" />
						<p className="text-muted-foreground">
							{t("linear:noSimilarIssuesFound")}
						</p>
					</div>
				) : (
					<div className="space-y-6 mt-4">
						{/* Potential Duplicates */}
						{duplicates.length > 0 && (
							<section>
								<h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
									<Merge className="h-4 w-4 text-red-500" />
									{t("linear:potentialDuplicates")} ({duplicates.length})
								</h3>
								<div className="space-y-3">
									{duplicates.map((ticket) => (
										<div
											key={ticket.ticket_id}
											className="p-4 rounded-lg border border-border bg-card"
										>
											<div className="flex items-start justify-between mb-2">
												<div className="flex-1">
													<div className="flex items-center gap-2 mb-1">
														<span className="font-medium">
															{ticket.ticket_id}
														</span>
														<Badge
															variant="outline"
															className={getActionColor(
																ticket.recommended_action,
															)}
														>
															{t("linear:duplicate")}
														</Badge>
														<Badge
															variant="outline"
															className={getConfidenceColor(
																ticket.confidence,
															)}
														>
															{ticket.similarity_score > 0
																? `${Math.round(
																		ticket.similarity_score *
																			100,
																  )}% match`
																: t("linear:unknown")}
														</Badge>
													</div>
													<p className="text-sm text-muted-foreground">
														{ticket.similarity_reasoning}
													</p>
												</div>
												{onMarkDuplicate && (
													<Button
														variant="outline"
														size="sm"
														onClick={() =>
															onMarkDuplicate(
																targetTicketId,
																ticket.ticket_id,
															)
														}
														className="ml-4"
													>
														<Merge className="h-4 w-4 mr-2" />
														{t("linear:markAsDuplicate")}
													</Button>
												)}
											</div>
											{ticket.shared_keywords &&
												ticket.shared_keywords.length > 0 && (
												<div className="flex flex-wrap gap-1 mt-2">
													{ticket.shared_keywords.map((keyword) => (
														<Badge
															key={keyword}
															variant="secondary"
															className="text-xs"
														>
															{keyword}
														</Badge>
													))}
												</div>
											)}
										</div>
									))}
								</div>
							</section>
						)}

						{/* Related Tickets */}
						{related.length > 0 && (
							<section>
								<h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
									<Link2 className="h-4 w-4 text-blue-500" />
									{t("linear:relatedTickets")} ({related.length})
								</h3>
								<div className="space-y-3">
									{related.map((ticket) => (
										<div
											key={ticket.ticket_id}
											className="p-4 rounded-lg border border-border bg-card"
										>
											<div className="flex items-start justify-between mb-2">
												<div className="flex-1">
													<div className="flex items-center gap-2 mb-1">
														<span className="font-medium">
															{ticket.ticket_id}
														</span>
														<Badge
															variant="outline"
															className={getActionColor(
																ticket.recommended_action,
															)}
														>
															{t("linear:related")}
														</Badge>
														<Badge
															variant="outline"
															className={getConfidenceColor(
																ticket.confidence,
															)}
														>
															{ticket.similarity_score > 0
																? `${Math.round(
																		ticket.similarity_score *
																			100,
																  )}% match`
																: t("linear:unknown")}
														</Badge>
													</div>
													<p className="text-sm text-muted-foreground">
														{ticket.similarity_reasoning}
													</p>
												</div>
												{onLinkTickets && (
													<Button
														variant="outline"
														size="sm"
														onClick={() =>
															onLinkTickets(
																targetTicketId,
																ticket.ticket_id,
															)
														}
														className="ml-4"
													>
														<Link2 className="h-4 w-4 mr-2" />
														{t("linear:linkTickets")}
													</Button>
												)}
											</div>
											{ticket.differences && (
												<p className="text-xs text-muted-foreground mt-2">
													{t("linear:differences")}:{" "}
													{ticket.differences}
												</p>
											)}
										</div>
									))}
								</div>
							</section>
						)}
					</div>
				)}

				<div className="flex justify-end mt-4 pt-4 border-t">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("linear:cancel")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

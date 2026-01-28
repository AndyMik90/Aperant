/**
 * Dialog for displaying resolution status of Linear tickets
 * Shows which tickets have already been fixed/resolved
 */

import { CheckCircle2, GitCommit, Package, X } from "lucide-react";
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
import { Separator } from "../../ui/separator";

export interface ResolutionEvidence {
	type: "commit" | "release" | "code_change";
	description: string;
	url: string;
	date: string;
}

export interface ResolutionTicketResult {
	ticket_id: string;
	is_already_fixed: boolean;
	confidence: "high" | "medium" | "low";
	evidence: ResolutionEvidence[];
	reasoning: string;
	recommended_action: "close" | "keep_open" | "investigate";
	suggested_close_reason?: string;
}

interface ResolutionCheckDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tickets: ResolutionTicketResult[];
	onCloseTickets?: (ticketIds: string[], reason: string) => void;
	isLoading?: boolean;
}

export function ResolutionCheckDialog({
	open,
	onOpenChange,
	tickets,
	onCloseTickets,
	isLoading = false,
}: ResolutionCheckDialogProps) {
	const { t } = useTranslation(["common", "linear"]);

	const alreadyFixed = tickets.filter((tkt) => tkt.is_already_fixed);
	const potentiallyFixed = tickets.filter(
		(tkt) => !tkt.is_already_fixed && tkt.recommended_action === "investigate",
	);
	const stillOpen = tickets.filter(
		(tkt) => tkt.recommended_action === "keep_open",
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

	const getEvidenceIcon = (type: string) => {
		switch (type) {
			case "commit":
				return <GitCommit className="h-3 w-3" />;
			case "release":
				return <Package className="h-3 w-3" />;
			default:
				return <CheckCircle2 className="h-3 w-3" />;
		}
	};

	const handleCloseSelected = () => {
		if (!onCloseTickets) return;
		const toClose = [...alreadyFixed, ...potentiallyFixed];
		const reasons = toClose.map(
			(t) => t.suggested_close_reason || t.reasoning,
		);
		const combinedReason = `Closed as resolved: ${reasons.join("; ")}`;
		onCloseTickets(toClose.map((t) => t.ticket_id), combinedReason);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<CheckCircle2 className="h-5 w-5 text-green-500" />
						{t("linear:checkResolution")}
					</DialogTitle>
					<DialogDescription>
						{t("linear:checkResolutionStatus")}
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<div className="text-muted-foreground">
							{t("linear:checkingResolution")}
						</div>
					</div>
				) : tickets.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4" />
						<p className="text-muted-foreground">
							{t("linear:noResultsFound")}
						</p>
					</div>
				) : (
					<div className="space-y-6 mt-4">
						{/* Already Fixed */}
						{alreadyFixed.length > 0 && (
							<section>
								<h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
									<CheckCircle2 className="h-4 w-4 text-green-500" />
									{t("linear:alreadyFixed")} ({alreadyFixed.length})
								</h3>
								<div className="space-y-3">
									{alreadyFixed.map((ticket) => (
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
															className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30"
														>
															{t("linear:alreadyFixed")}
														</Badge>
														<Badge
															variant="outline"
															className={getConfidenceColor(
																ticket.confidence,
															)}
														>
															{ticket.confidence.toUpperCase()}
														</Badge>
													</div>
													<p className="text-sm text-muted-foreground mb-2">
														{ticket.reasoning}
													</p>
													{ticket.suggested_close_reason && (
														<p className="text-xs text-muted-foreground italic">
															{t("linear:suggested_close_reason")}:{" "}
															{
																ticket.suggested_close_reason
															}
														</p>
													)}
												</div>
											</div>
											{ticket.evidence.length > 0 && (
												<>
													<Separator className="my-2" />
													<div className="space-y-2">
														<p className="text-xs font-medium">
															{t("linear:resolutionEvidence")}:
														</p>
														{ticket.evidence.map((ev, idx) => (
															<div
																key={idx}
																className="flex items-start gap-2 text-xs"
															>
																{getEvidenceIcon(ev.type)}
																<div className="flex-1">
																	<p className="text-foreground">
																		{ev.description}
																	</p>
																	<p className="text-muted-foreground">
																		{ev.date}
																	</p>
																</div>
															</div>
														))}
													</div>
												</>
											)}
										</div>
									))}
								</div>
							</section>
						)}

						{/* Potentially Fixed */}
						{potentiallyFixed.length > 0 && (
							<section>
								<h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
									<Package className="h-4 w-4 text-yellow-500" />
									{t("linear:potentiallyFixed")} ({potentiallyFixed.length})
								</h3>
								<div className="space-y-3">
									{potentiallyFixed.map((ticket) => (
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
															className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
														>
															{t("linear:potentiallyFixed")}
														</Badge>
														<Badge
															variant="outline"
															className={getConfidenceColor(
																ticket.confidence,
															)}
														>
															{ticket.confidence.toUpperCase()}
														</Badge>
													</div>
													<p className="text-sm text-muted-foreground mb-2">
														{ticket.reasoning}
													</p>
													<Button
														variant="outline"
														size="sm"
														className="text-xs"
														onClick={() => {
															if (
																onCloseTickets &&
																ticket.suggested_close_reason
															) {
																onCloseTickets(
																	[ticket.ticket_id],
																	ticket.suggested_close_reason,
																);
															}
														}}
													>
														{t("linear:closeTicket")}
													</Button>
												</div>
											</div>
											{ticket.evidence.length > 0 && (
												<>
													<Separator className="my-2" />
													<div className="space-y-2">
														<p className="text-xs font-medium">
															{t("linear:resolutionEvidence")}:
														</p>
														{ticket.evidence.map((ev, idx) => (
															<div
																key={idx}
																className="flex items-start gap-2 text-xs"
															>
																{getEvidenceIcon(ev.type)}
																<div className="flex-1">
																	<p className="text-foreground">
																		{ev.description}
																	</p>
																	<p className="text-muted-foreground">
																		{ev.date}
																	</p>
																</div>
															</div>
														))}
													</div>
												</>
											)}
										</div>
									))}
								</div>
							</section>
						)}

						{/* Still Open */}
						{stillOpen.length > 0 && (
							<section>
								<h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
									<X className="h-4 w-4 text-gray-500" />
									{t("linear:stillOpen")} ({stillOpen.length})
								</h3>
								<div className="space-y-2">
									{stillOpen.map((ticket) => (
										<div
											key={ticket.ticket_id}
											className="p-3 rounded-lg border border-border bg-card/50"
										>
											<div className="flex items-center gap-2 mb-1">
												<span className="font-medium text-sm">
													{ticket.ticket_id}
												</span>
												<Badge variant="secondary" className="text-xs">
													{t("linear:stillOpen")}
												</Badge>
											</div>
											<p className="text-xs text-muted-foreground">
												{ticket.reasoning}
											</p>
										</div>
									))}
								</div>
							</section>
						)}
					</div>
				)}

				{/* Action Buttons */}
				<div className="flex justify-between items-center mt-4 pt-4 border-t">
					<div className="text-sm text-muted-foreground">
						{t("linear:closeSelectedTickets", {
							count: alreadyFixed.length + potentiallyFixed.length,
						})}
					</div>
					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							{t("linear:cancel")}
						</Button>
						{alreadyFixed.length > 0 && onCloseTickets && (
							<Button onClick={handleCloseSelected}>
								<CheckCircle2 className="h-4 w-4 mr-2" />
								{t("linear:closeTickets")}
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

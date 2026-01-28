import {
	CheckCircle2,
	Clock,
	ExternalLink,
	Loader2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useTranslation } from "react-i18next";
import { debugLog, debugError } from "@shared/utils/debug-logger";
import type {
	LinearTicket,
	ValidationResult,
} from "../../../../shared/types";
import { ValidationModal } from "./ValidationModal";

interface LinearTicketDetailProps {
	ticket: LinearTicket | null;
	validationResult: ValidationResult | null;
	isValidating: boolean;
	onRunValidation: () => Promise<void>;
}

export function LinearTicketDetail({
	ticket,
	validationResult,
	isValidating,
	onRunValidation,
}: LinearTicketDetailProps) {
	const { t } = useTranslation(["common", "linear"]);
	const [showValidationModal, setShowValidationModal] = useState(false);
	const validation = validationResult;
	const detailRef = useRef<HTMLDivElement>(null);

	// Scroll to top when ticket changes
	useEffect(() => {
		if (detailRef.current) {
			detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, [ticket?.id]);

	if (!ticket) {
		return (
			<div
				className="flex items-center justify-center h-full text-muted-foreground"
				role="status"
				aria-live="polite"
			>
				<Clock className="w-5 h-5 mr-2" aria-hidden="true" />
				<p>{t("linear:selectTicket")}</p>
			</div>
		);
	}

	const handleValidate = async () => {
		debugLog("[LinearTicketDetail] handleValidate called, ticket:", ticket?.id);
		try {
			await onRunValidation();
			debugLog("[LinearTicketDetail] Validation completed, showing modal");
			setShowValidationModal(true);
		} catch (error) {
			debugError("[LinearTicketDetail] Validation failed:", error);
		}
	};

	const getPriorityBadgeClass = (priority: number) => {
		if (priority >= 4)
			return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
		if (priority === 3)
			return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
		if (priority === 2)
			return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
		return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
	};

	const getStatusColor = (stateType: string) => {
		const colors: Record<string, string> = {
			backlog: "text-gray-500",
			todo: "text-gray-400",
			started: "text-yellow-600",
			"in-progress": "text-blue-600",
			done: "text-green-600",
			canceled: "text-red-400",
		};
		return colors[stateType] || "text-gray-500";
	};

	return (
		<div
			ref={detailRef}
			className="flex flex-col h-full gap-4 p-4 overflow-y-auto"
			role="region"
			aria-label={t("linear:ticketDetailsFor", { identifier: ticket.identifier })}
		>
			{/* Header */}
			<div className="flex items-start justify-between gap-4">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<h2 className="text-xl font-semibold truncate">{ticket.title}</h2>
						<a
							href={ticket.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-foreground hover:text-foreground transition-colors"
							aria-label={t("linear:viewOnLinear")}
						>
							<ExternalLink className="w-4 h-4 flex-shrink-0" />
						</a>
					</div>
					<p className="text-sm text-muted-foreground">{ticket.identifier}</p>
				</div>

				{/* Validation Status Badge */}
				{isValidating ? (
					<div
						className="flex items-center gap-1 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 rounded-full"
						role="status"
						aria-live="polite"
					>
						<Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" aria-hidden="true" />
						<span className="text-xs text-blue-700 dark:text-blue-300">
							{t("linear:validatingTicket")}
						</span>
					</div>
				) : validation?.status === "complete" ? (
					<div
						className="flex items-center gap-1 px-2 py-1 bg-green-50 dark:bg-green-900/20 rounded-full"
						role="status"
						aria-live="polite"
					>
						<CheckCircle2
							className="w-4 h-4 text-green-600 dark:text-green-400"
							aria-hidden="true"
						/>
						<span className="text-xs text-green-700 dark:text-green-300">
							{t("linear:validated")}
						</span>
					</div>
				) : validation?.status === "error" ? (
					<div
						className="flex items-center gap-1 px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded-full"
						role="status"
						aria-live="polite"
					>
						<Clock className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
						<span className="text-xs text-red-700 dark:text-red-300">
							{t("linear:validationFailed")}
						</span>
					</div>
				) : (
					<div
						className="flex items-center gap-1 px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded-full"
						role="status"
						aria-live="polite"
					>
						<Clock className="w-4 h-4 text-gray-400" aria-hidden="true" />
						<span className="text-xs text-gray-500">
							{t("linear:notValidated")}
						</span>
					</div>
				)}
			</div>

			{/* Metadata Badges */}
			<div
				className="flex flex-wrap gap-2"
				role="list"
				aria-label={t("linear:ticketMetadata")}
			>
				<div
					className="px-2 py-1 rounded-md bg-secondary text-sm"
					role="listitem"
				>
					<span className="text-muted-foreground">{t("linear:status")}:</span>{" "}
					<span className={getStatusColor(ticket.state.type)}>
						{ticket.state.name}
					</span>
				</div>
				<div
					className={`px-2 py-1 rounded-md text-sm ${getPriorityBadgeClass(ticket.priority)}`}
					role="listitem"
				>
					<span className="text-muted-foreground">{t("linear:priority")}:</span>{" "}
					{ticket.priorityLabel}
				</div>
				{ticket.assignee && (
					<div
						className="px-2 py-1 rounded-md bg-secondary text-sm"
						role="listitem"
					>
						<span className="text-muted-foreground">
							{t("linear:assignee")}:
						</span>{" "}
						{ticket.assignee.name}
					</div>
				)}
				{ticket.project && (
					<div
						className="px-2 py-1 rounded-md bg-secondary text-sm"
						role="listitem"
					>
						<span className="text-muted-foreground">
							{t("linear:project")}:
						</span>{" "}
						{ticket.project.name}
					</div>
				)}
				<div
					className="px-2 py-1 rounded-md bg-secondary text-sm text-muted-foreground"
					role="listitem"
				>
					{new Date(ticket.createdAt).toLocaleDateString()}
				</div>
			</div>

			{/* Labels */}
			{ticket.labels && ticket.labels.length > 0 && (
				<div
					className="flex flex-wrap gap-1"
					role="list"
					aria-label={t("linear:labels")}
				>
					{ticket.labels.map((label: { id: string; name: string; color: string }) => (
						<span
							key={label.id}
							className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium"
							style={{
								backgroundColor: label.color ? `${label.color}20` : undefined,
							}}
							role="listitem"
							aria-label={t("linear:labelAriaLabel", { name: label.name })}
						>
							{label.name}
						</span>
					))}
				</div>
			)}

			{/* Description */}
			<div className="flex-1">
				<h3 className="text-sm font-medium mb-2">{t("linear:description")}</h3>
				<div className="p-3 rounded-md bg-secondary/50 text-sm text-foreground [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-1 [&_blockquote]:my-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:text-xs [&_code]:font-mono [&_pre]:my-3 [&_pre]:p-3 [&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_a]:text-primary [&_a]:hover:underline">
					{ticket.description ? (
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							rehypePlugins={[rehypeSanitize]}
							skipHtml={false}
							components={{
								// Custom code component with syntax detection and styling
								code({ inline, className, children, ...props }: any) {
									const match = /language-(\w+)/.exec(className || '');
									const hasLanguage = match && match[1];

									// Inline code
									if (inline) {
										return (
											<code
												className="px-1 py-0.5 bg-muted dark:bg-muted/70 rounded text-xs font-mono text-foreground"
											>
												{children}
											</code>
										);
									}

									// Block code with language detection
									return (
										<div className="group relative my-3 not-prose">
											{hasLanguage && (
												<span className="absolute top-2 right-2 px-2 py-0.5 text-xs font-mono text-muted-foreground bg-muted/50 rounded select-none">
													{match[1]}
												</span>
											)}
											<pre className="bg-muted dark:bg-muted/80 p-3 rounded-lg overflow-x-auto text-sm border border-border/50">
												<code className={className}>{children}</code>
											</pre>
										</div>
									);
								},
								// Custom link component
								a({ href, children, ...props }: any) {
									return (
										<a
											href={href}
											className="text-primary hover:underline inline-flex items-center gap-0.5"
											target="_blank"
											rel="noopener noreferrer"
											{...props}
										>
											{children}
										</a>
									);
								},
							}}
						>
							{ticket.description}
						</ReactMarkdown>
					) : (
						<p className="text-sm text-muted-foreground italic">
							{t("linear:noDescription")}
						</p>
					)}
				</div>
			</div>

			{/* Actions */}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={handleValidate}
					disabled={isValidating}
					className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					aria-label={t("linear:runValidation")}
					aria-busy={isValidating}
				>
					{isValidating ? (
						<>
							<Loader2 className="w-4 h-4 animate-spin" />
							{t("linear:validatingTicket")}
						</>
					) : (
						<>
							<CheckCircle2 className="w-4 h-4" />
							{t("linear:runValidation")}
						</>
					)}
				</button>
			</div>

			{/* Validation Summary (if validated) */}
			{!isValidating && validation?.status === "complete" && (
				<div
					className="p-4 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
					role="region"
					aria-live="polite"
					aria-label={t("linear:validationResults")}
				>
					<div className="flex items-center gap-2 mb-2">
						<CheckCircle2
							className="w-5 h-5 text-green-600 dark:text-green-400"
							aria-hidden="true"
						/>
						<h4 className="font-medium text-green-900 dark:text-green-100">
							{t("linear:validationComplete")}
						</h4>
					</div>
					<div className="text-sm text-green-800 dark:text-green-200 space-y-1">
						{validation.versionRecommendation && (
							<div>
								<span className="font-medium">
									{t("linear:recommendedVersion")}:
								</span>{" "}
								{validation.versionRecommendation.recommendedVersion}
							</div>
						)}
						{validation.taskProperties && (
							<div>
								<span className="font-medium">{t("linear:category")}:</span>{" "}
								{validation.taskProperties.category}
							</div>
						)}
					</div>
					<button
						type="button"
						onClick={() => setShowValidationModal(true)}
						className="mt-3 text-sm text-green-700 dark:text-green-300 underline hover:no-underline"
					>
						{t("linear:viewFullValidation")}
					</button>
				</div>
			)}

			{/* Validation Modal */}
			{ticket.identifier && (
				<ValidationModal
					open={showValidationModal}
					onOpenChange={setShowValidationModal}
					ticketId={ticket.identifier}
					validation={validationResult}
				/>
			)}
		</div>
	);
}

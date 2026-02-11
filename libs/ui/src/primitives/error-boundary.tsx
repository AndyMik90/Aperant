import { AlertTriangle, RefreshCw } from "lucide-react";
import React from "react";
import { Button } from "./button";
import { Card, CardContent } from "./card";

export interface ErrorBoundaryLabels {
	title?: string;
	message?: string;
	retryButton?: string;
}

interface ErrorBoundaryProps {
	children: React.ReactNode;
	fallback?: React.ReactNode;
	onReset?: () => void;
	onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
	/** Override default English labels for i18n */
	labels?: ErrorBoundaryLabels;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Error boundary component to gracefully handle render errors.
 * Prevents the entire page from crashing when a component fails.
 */
export class ErrorBoundary extends React.Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		console.error("ErrorBoundary caught an error:", error, errorInfo);

		// Report error via optional callback
		this.props.onError?.(error, errorInfo);
	}

	handleReset = (): void => {
		this.setState({ hasError: false, error: null });
		this.props.onReset?.();
	};

	render(): React.ReactNode {
		if (this.state.hasError) {
			if (this.props.fallback) {
				return this.props.fallback;
			}

			const labels = this.props.labels;

			return (
				<Card className="border-destructive m-4">
					<CardContent className="pt-6">
						<div className="flex flex-col items-center gap-4 text-center">
							<AlertTriangle className="h-10 w-10 text-destructive" />
							<div className="space-y-2">
								<h3 className="font-semibold text-lg">
									{labels?.title ?? "Something went wrong"}
								</h3>
								<p className="text-sm text-muted-foreground">
									{labels?.message ??
										"An error occurred while rendering this content."}
								</p>
								{this.state.error && (
									<p className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded max-w-md overflow-auto">
										{this.state.error.message}
									</p>
								)}
							</div>
							<Button onClick={this.handleReset} variant="outline" size="sm">
								<RefreshCw className="h-4 w-4 mr-2" />
								{labels?.retryButton ?? "Try Again"}
							</Button>
						</div>
					</CardContent>
				</Card>
			);
		}

		return this.props.children;
	}
}

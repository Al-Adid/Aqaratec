CREATE TABLE `prototypeWorkspaces` (
	`userId` int NOT NULL,
	`snapshot` json NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prototypeWorkspaces_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `prototypeWorkspaces` ADD CONSTRAINT `prototypeWorkspaces_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
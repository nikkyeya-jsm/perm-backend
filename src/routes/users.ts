import express from "express";
import { and, desc, eq, ilike, or, sql, getTableColumns } from "drizzle-orm";

import { db } from "../db";
import { classes, departments, enrollments, subjects, user } from "../db/schema";

const router = express.Router();

// Get all users with optional search, role filter, and pagination
router.get("/", async (req, res) => {
  try {
    const { search, role, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, +page);
    const limitPerPage = Math.max(1, +limit);
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];

    if (search) {
      filterConditions.push(
        or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
      );
    }

    if (role) {
      filterConditions.push(eq(user.role, role as UserRoles));
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(user)
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    const usersList = await db
      .select()
      .from(user)
      .where(whereClause)
      .orderBy(desc(user.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: usersList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get user details with role-specific data
router.get("/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    const [userDetails] = await db
      .select({
        ...getTableColumns(user),
      })
      .from(user)
      .where(eq(user.id, userId));

    if (!userDetails) {
      return res.status(404).json({ error: "User not found" });
    }

    if (userDetails.role === "teacher") {
      const classesList = await db
        .select({
          ...getTableColumns(classes),
          subject: {
            ...getTableColumns(subjects),
          },
          department: {
            ...getTableColumns(departments),
          },
        })
        .from(classes)
        .leftJoin(subjects, eq(classes.subjectId, subjects.id))
        .leftJoin(departments, eq(subjects.departmentId, departments.id))
        .where(eq(classes.teacherId, userId))
        .orderBy(desc(classes.createdAt));

      const subjectMap = new Map<number, typeof subjects.$inferSelect>();
      const departmentMap = new Map<number, typeof departments.$inferSelect>();

      for (const classItem of classesList) {
        if (classItem.subject?.id) {
          subjectMap.set(classItem.subject.id, classItem.subject);
        }
        if (classItem.department?.id) {
          departmentMap.set(classItem.department.id, classItem.department);
        }
      }

      res.status(200).json({
        data: {
          user: userDetails,
          classes: classesList,
          subjects: Array.from(subjectMap.values()),
          departments: Array.from(departmentMap.values()),
          totals: {
            classes: classesList.length,
            subjects: subjectMap.size,
            departments: departmentMap.size,
          },
        },
      });

      return;
    }

    if (userDetails.role === "student") {
      const enrollmentsList = await db
        .select({
          ...getTableColumns(enrollments),
          class: {
            ...getTableColumns(classes),
          },
          subject: {
            ...getTableColumns(subjects),
          },
          department: {
            ...getTableColumns(departments),
          },
          teacher: {
            ...getTableColumns(user),
          },
        })
        .from(enrollments)
        .leftJoin(classes, eq(enrollments.classId, classes.id))
        .leftJoin(subjects, eq(classes.subjectId, subjects.id))
        .leftJoin(departments, eq(subjects.departmentId, departments.id))
        .leftJoin(user, eq(classes.teacherId, user.id))
        .where(eq(enrollments.studentId, userId))
        .orderBy(desc(enrollments.createdAt));

      const classMap = new Map<number, typeof classes.$inferSelect>();
      const subjectMap = new Map<number, typeof subjects.$inferSelect>();

      for (const enrollment of enrollmentsList) {
        if (enrollment.class?.id) {
          classMap.set(enrollment.class.id, enrollment.class);
        }
        if (enrollment.subject?.id) {
          subjectMap.set(enrollment.subject.id, enrollment.subject);
        }
      }

      res.status(200).json({
        data: {
          user: userDetails,
          enrollments: enrollmentsList,
          classes: Array.from(classMap.values()),
          subjects: Array.from(subjectMap.values()),
          totals: {
            enrollments: enrollmentsList.length,
            classes: classMap.size,
            subjects: subjectMap.size,
          },
        },
      });

      return;
    }

    res.status(200).json({
      data: {
        user: userDetails,
      },
    });
  } catch (error) {
    console.error("GET /users/:id error:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

export default router;

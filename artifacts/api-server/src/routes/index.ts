import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import fieldRouter from "./field";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/mobile", authRouter);
router.use("/mobile", fieldRouter);

export default router;

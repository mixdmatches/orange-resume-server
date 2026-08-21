import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { ResumeService } from './resume.service'
import { CreateResumeDto, UpdateResumeDto, DeleteBatchResumeDto } from './dto/resume.dto'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { JwtPayload } from '../../common/types/jwt-payload'

/**
 * 简历相关路由控制器
 * 路由前缀：resumes（配合全局 /api → /api/resumes/*）
 * 所有路由均需登录（JWT 守卫）
 */
@ApiTags('📄 简历 Resumes')
@ApiBearerAuth('bearer')
@Controller('resumes')
@UseGuards(JwtAuthGuard)
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  /**
   * 创建简历
   * POST /api/resumes
   * @param user 当前登录用户
   * @param dto 创建参数
   * @returns 新简历 { id }
   */
  @ApiOperation({
    summary: '创建一份新简历',
    description:
      '前端把完整的 Resume 对象整个放在 content 里提交，后端生成 8 位短 ID 后存储。content 字段会原样写入 MySQL JSON 列，不做深度校验。',
  })
  @ApiBody({ type: CreateResumeDto })
  @ApiResponse({
    status: 200,
    description: 'code=0，data = { id: "a1b2c" }。id 是 8 位随机短字符串。',
  })
  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateResumeDto) {
    return this.resumeService.createResume(user.userId, dto)
  }

  /**
   * 获取我的简历列表
   * GET /api/resumes
   * @param user 当前登录用户
   * @returns { list, total } 摘要列表（不含 content）
   */
  @ApiOperation({
    summary: '获取我的简历列表（列表页用）',
    description:
      '返回当前登录用户名下所有简历的「摘要」，按 updatedAt 倒序。注意：为了列表接口轻量化，**不返回 content 字段**；需要完整内容请调用 GET /resumes/:id。',
  })
  @ApiResponse({
    status: 200,
    description:
      'code=0，data = { list: [{id,title,templateId,createdAt,updatedAt}, ...], total: n }。时间戳是毫秒 number。',
  })
  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.resumeService.getMyResumes(user.userId)
  }

  /**
   * 获取单份简历详情
   * GET /api/resumes/:id
   * @param user 当前登录用户
   * @param id 简历 ID
   * @returns 完整 Resume 对象（含 content 展开的所有字段）
   */
  @ApiOperation({
    summary: '获取一份简历的完整详情',
    description:
      '打开编辑器时调用。返回内容 = MySQL content JSON 列 + id/title/templateId/createdAt/updatedAt（数据库列会覆盖 content 中同名字段，保证单一事实源）。不是自己的简历会返回 40301。',
  })
  @ApiParam({ name: 'id', example: 'a1b2c', description: '8 位简历 ID' })
  @ApiResponse({
    status: 200,
    description: 'code=0，data = Resume 完整对象（前端直接赋值即可渲染）',
  })
  @ApiResponse({ status: 200, description: '简历不存在 → code=40401；不属于当前用户 → code=40301' })
  @Get(':id')
  async detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.resumeService.getResumeDetail(user.userId, id)
  }

  /**
   * 更新简历
   * PUT /api/resumes/:id
   * @param user 当前登录用户
   * @param id 简历 ID
   * @param dto 更新参数
   * @returns { id, updatedAt }
   */
  @ApiOperation({
    summary: '全量更新一份简历',
    description:
      'MVP 策略：每次编辑保存后前端把最新的完整 Resume 对象传入，直接全量覆盖 content JSON。updatedAt 会自动刷新。非自己的简历 40301。',
  })
  @ApiParam({ name: 'id', example: 'a1b2c' })
  @ApiBody({ type: UpdateResumeDto })
  @ApiResponse({
    status: 200,
    description:
      'code=0，data = { id, updatedAt: 毫秒时间戳 }。前端可通过 updatedAt 与当前列表项比对，判断本地数据是否最新。',
  })
  @Put(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateResumeDto,
  ) {
    return this.resumeService.updateResume(user.userId, id, dto)
  }

  /**
   * 删除简历
   * DELETE /api/resumes/:id
   * @param user 当前登录用户
   * @param id 简历 ID
   * @returns { success: true }
   */
  @ApiOperation({
    summary: '删除一份简历（硬删除）',
    description:
      '物理删除数据库行，删除后不可恢复。列表页回收站场景可在前端自行改成软删除方案。非自己的简历 40301。',
  })
  @ApiParam({ name: 'id', example: 'a1b2c' })
  @ApiResponse({ status: 200, description: 'code=0，data = { success: true }' })
  @Delete(':id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.resumeService.deleteResume(user.userId, id)
  }

  /**
   * 删除多份简历
   * DELETE /api/resumes/batch
   * @param user 当前登录用户
   * @param ids 简历 ID 列表
   * @returns { success: true }
   */
  @ApiOperation({
    summary: '删除多份简历（硬删除）',
    description:
      '物理删除数据库行，删除后不可恢复。列表页回收站场景可在前端自行改成软删除方案。非自己的简历 40301。',
  })
  @ApiBody({ type: DeleteBatchResumeDto })
  @ApiResponse({ status: 200, description: 'code=0，data = { success: true }' })
  @Delete('batch')
  async removeBatch(@CurrentUser() user: JwtPayload, @Body() dto: DeleteBatchResumeDto) {
    return this.resumeService.deleteBatchResumes(user.userId, dto.ids)
  }

  /**
   * 复制简历
   * POST /api/resumes/:id/duplicate
   * @param user 当前登录用户
   * @param id 原始简历 ID
   * @returns { newId }
   */
  @ApiOperation({
    summary: '复制一份简历',
    description:
      '基于现有简历 clone 一份新的：生成新 8 位 ID，标题自动追加「 副本」，content 全部相同，createdAt/updatedAt 重置为当前时间。非自己的简历 40301。',
  })
  @ApiParam({ name: 'id', example: 'a1b2c' })
  @ApiResponse({ status: 200, description: 'code=0，data = { newId: "d3e4f" }' })
  @Post(':id/duplicate')
  async duplicate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.resumeService.duplicateResume(user.userId, id)
  }
}
